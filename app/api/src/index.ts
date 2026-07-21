/**
 * WCL examination system: production backend.
 *
 * Bun + Express + PostgreSQL (Drizzle) + Redis. See docs/EXAM_SYSTEM_PLAN.md.
 *
 * Composition lives here; behaviour lives in the routers and services:
 *   routes/exam.ts   candidate authentication and the exam lifecycle
 *   routes/admin.ts  admin authentication, management, and reporting
 *   ws.ts            admin live WebSocket (leaderboard and session pushes)
 */

import http from "node:http";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { eq } from "drizzle-orm";

import { db } from "./db/index.ts";
import { admins, exams } from "./db/schema.ts";
import { env, isProduction } from "./env.ts";
import { logger } from "./logger.ts";
import { errorHandler, notFoundHandler } from "./http/middleware.ts";
import { metricsHandler, requestObserver } from "./http/metrics.ts";
import { examRouter, startAutoSubmitSweep } from "./routes/exam.ts";
import { adminRouter } from "./routes/admin.ts";
import { attachAdminWs } from "./ws.ts";
import pkg from "../package.json";

/** Bun runtime global (argon2id hashing); tsconfig only pulls in @types/node. */
declare const Bun: {
  password: { hash(password: string): Promise<string> };
};

/**
 * Production bootstrap: on a clean database, create the admin account and the
 * exam from environment configuration so a deployment never needs manual SQL.
 * Rows are only created when missing; existing rows are never modified (so
 * changing ADMIN_PASSWORD later does not update an existing admin). In
 * development `bun run seed` is used instead — it also fabricates the question
 * bank and candidates, and this bootstrap must not pre-create the exam it
 * checks for.
 */
async function bootstrap(): Promise<void> {
  const [admin] = await db.select({ id: admins.id }).from(admins).limit(1);
  if (!admin) {
    await db.insert(admins).values({
      email: env.ADMIN_EMAIL,
      passwordHash: await Bun.password.hash(env.ADMIN_PASSWORD),
    });
    logger.info({ email: env.ADMIN_EMAIL }, "bootstrap: admin account created from env");
  }

  const [exam] = await db
    .select({ id: exams.id })
    .from(exams)
    .where(eq(exams.id, env.EXAM_ID))
    .limit(1);
  if (!exam) {
    const minutes = Math.round(env.EXAM_DURATION_SECONDS / 60);
    await db.insert(exams).values({
      id: env.EXAM_ID,
      title: env.EXAM_TITLE,
      durationSeconds: env.EXAM_DURATION_SECONDS,
      questionsToServe: env.EXAM_QUESTIONS_TO_SERVE,
      isOpen: false, // opened explicitly via POST /admin/exams/:id/open when the event starts
      instructions: [
        `The examination duration is ${minutes} minutes, measured from the moment you begin.`,
        `You will be served ${env.EXAM_QUESTIONS_TO_SERVE} questions.`,
        "Each wrong answer deducts 0.5 marks; unanswered questions score zero.",
        "For multiple correct questions, the mark is awarded only when your selection exactly matches the correct set of options.",
        "Your responses are saved automatically and synchronised with the server at regular intervals.",
        "The server clock is authoritative; the timer shown on your screen is provided only for guidance.",
      ],
    });
    logger.info(
      { examId: env.EXAM_ID },
      "bootstrap: exam created from env (closed; open it via the admin panel)",
    );
  }
}

const app = express();
app.set("trust proxy", env.TRUST_PROXY_HOPS);
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(requestObserver);

/** Prometheus scrape target (bearer METRICS_TOKEN; 404 when unset). */
app.get("/metrics", metricsHandler);

/** Liveness probe. */
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "wcl-api",
    version: pkg.version,
    time: new Date().toISOString(),
  });
});

/** Server time for client offset (NTP-style) calculation. */
app.get("/time", (_req: Request, res: Response) => {
  res.status(200).json({ serverTime: new Date().toISOString() });
});

app.use(examRouter);
app.use("/admin", adminRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = http.createServer(app);
attachAdminWs(server);

// Development seeds demo data with `bun run seed`; production self-initializes.
if (isProduction) await bootstrap();

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, clockMultiplier: env.CLOCK_MULTIPLIER }, "wcl-api listening");
});

startAutoSubmitSweep();

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

import { env } from "./env.ts";
import { logger } from "./logger.ts";
import { errorHandler, notFoundHandler } from "./http/middleware.ts";
import { examRouter, startAutoSubmitSweep } from "./routes/exam.ts";
import { adminRouter } from "./routes/admin.ts";
import { attachAdminWs } from "./ws.ts";

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/** Liveness probe. */
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", service: "wcl-api", time: new Date().toISOString() });
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

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, clockMultiplier: env.CLOCK_MULTIPLIER }, "wcl-api listening");
});

startAutoSubmitSweep();

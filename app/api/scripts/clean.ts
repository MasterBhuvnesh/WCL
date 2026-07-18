/**
 * Remove imported data from the database. PREVIEW BY DEFAULT - it prints the
 * target database and row counts and deletes nothing until you add --yes.
 * Cleans only what the import scripts load; exam-run data (sessions, answers,
 * results) and the exams/admins rows are never touched.
 *
 * Usage:
 *   bun run clean <questions|participants|seats|all> [--yes]
 *
 *   questions     every question + its options for exam env.EXAM_ID, and the
 *                 Redis bank cache
 *   participants  every participant with no exam session (seat rows cascade);
 *                 participants who have taken/started the exam are kept
 *   seats         every hall-ticket seat row
 *   all           all three
 */

import { count, eq, inArray, notInArray } from "drizzle-orm";
import { db, pgClient, schema } from "../src/db/index.ts";
import { env } from "../src/env.ts";
import { redis } from "../src/redis.ts";

const { questions, options, participants, examSessions, hallticketSeats } = schema;

const TARGETS = ["questions", "participants", "seats", "all"] as const;
type Target = (typeof TARGETS)[number];

/** Close database and Redis connections, then terminate the process. */
async function shutdown(code: number): Promise<never> {
  await pgClient.end({ timeout: 5 });
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
  process.exit(code);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const yes = argv.includes("--yes");
  const target = argv.find((a) => !a.startsWith("--")) as Target | undefined;
  if (!target || !TARGETS.includes(target)) {
    console.error("usage: bun run clean <questions|participants|seats|all> [--yes]");
    console.error("Preview by default; --yes deletes. Sessions/answers/results/exams/admins are never touched.");
    process.exit(1);
  }

  // Make the blast radius obvious: this hits whatever DATABASE_URL points at.
  console.log(`Database: ${new URL(env.DATABASE_URL).host}`);
  const verb = yes ? "Deleted" : "Would delete";

  if (target === "questions" || target === "all") {
    const qIds = db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.examId, env.EXAM_ID));
    const [opt] = await db.select({ n: count() }).from(options).where(inArray(options.questionId, qIds));
    const [q] = await db.select({ n: count() }).from(questions).where(eq(questions.examId, env.EXAM_ID));
    if (yes) {
      await db.delete(options).where(inArray(options.questionId, qIds));
      await db.delete(questions).where(eq(questions.examId, env.EXAM_ID));
      await redis.del(`bank:${env.EXAM_ID}`);
    }
    console.log(
      `${verb}: ${q.n} question(s) + ${opt.n} option(s) of ${env.EXAM_ID}${yes ? " - bank cache flushed" : ""}`,
    );
  }

  if (target === "participants" || target === "all") {
    const sessioned = db.select({ id: examSessions.participantId }).from(examSessions);
    const [p] = await db
      .select({ n: count() })
      .from(participants)
      .where(notInArray(participants.id, sessioned));
    if (yes) {
      await db.delete(participants).where(notInArray(participants.id, sessioned));
      // Deleted participants must not keep logging in from the cache.
      const cached = await redis.keys("participant:*");
      if (cached.length > 0) await redis.del(...cached);
    }
    console.log(`${verb}: ${p.n} participant(s) without exam sessions (their seat rows cascade)`);
  }

  if (target === "seats" || target === "all") {
    const [s] = await db.select({ n: count() }).from(hallticketSeats);
    if (yes) {
      await db.delete(hallticketSeats);
    }
    console.log(`${verb}: ${s.n} hall-ticket seat row(s)`);
  }

  if (!yes) console.log("Preview only - re-run with --yes to actually delete.");
  await shutdown(0);
}

main().catch(async (error) => {
  console.error("Clean failed:", error instanceof Error ? error.message : error);
  await shutdown(1);
});

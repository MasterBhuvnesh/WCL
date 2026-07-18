/**
 * Wipe the ENTIRE database except the admins and exams tables. PREVIEW BY
 * DEFAULT - it prints the target database and row counts and deletes nothing
 * until you add --yes. Unlike `bun run clean`, this also removes exam-run
 * data: sessions, answers, results, feedback, integrity events, and audit
 * logs, plus every participant, question, and seat row. Redis session and
 * bank caches are flushed as well.
 *
 * Usage:
 *   bun run wipe [--yes]
 */

import { count } from "drizzle-orm";
import { db, pgClient, schema } from "../src/db/index.ts";
import { env } from "../src/env.ts";
import { redis } from "../src/redis.ts";

/** Deletion order respects foreign keys (children before parents). */
const TABLES = [
  ["feedback", schema.feedback],
  ["integrity_events", schema.integrityEvents],
  ["answers", schema.answers],
  ["results", schema.results],
  ["exam_sessions", schema.examSessions],
  ["hallticket_seats", schema.hallticketSeats],
  ["participants", schema.participants],
  ["options", schema.options],
  ["questions", schema.questions],
  ["audit_logs", schema.auditLogs],
] as const;

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
  const yes = process.argv.includes("--yes");

  // Make the blast radius obvious: this hits whatever DATABASE_URL points at.
  console.log(`Database: ${new URL(env.DATABASE_URL).host}`);
  console.log(`Redis: ${new URL(env.REDIS_URL).host}`);
  const verb = yes ? "Deleted" : "Would delete";

  for (const [name, table] of TABLES) {
    const [row] = await db.select({ n: count() }).from(table);
    if (yes) await db.delete(table);
    console.log(`${verb}: ${row.n} row(s) from ${name}`);
  }

  if (yes) {
    // Drop cached sessions and question banks so the API cannot serve ghosts.
    const keys = await redis.keys("session:*");
    keys.push(...(await redis.keys("bank:*")));
    keys.push(...(await redis.keys("leaderboard:*")));
    keys.push(...(await redis.keys("participant:*")));
    if (keys.length > 0) await redis.del(...keys);
    console.log(`Flushed ${keys.length} Redis key(s). Admins and exams kept.`);
  } else {
    console.log("Preview only - re-run with --yes to actually delete. Admins and exams are kept.");
  }
  await shutdown(0);
}

main().catch(async (error) => {
  console.error("Wipe failed:", error instanceof Error ? error.message : error);
  await shutdown(1);
});

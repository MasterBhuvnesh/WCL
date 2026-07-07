/**
 * Shared helpers for the admin router: audit logging, a thin TOTP wrapper over
 * otplib's functional API, leaderboard reconstruction from durable results, and
 * RFC 4180 CSV field encoding. Kept out of the router to keep route handlers
 * focused on request/response shaping.
 */

import { eq } from "drizzle-orm";
import { generateSecret, generateURI, verify } from "otplib";
import { db } from "../../db/index.ts";
import { auditLogs, results } from "../../db/schema.ts";
import { logger } from "../../logger.ts";
import { redis } from "../../redis.ts";

/**
 * Compatibility shim exposing the classic otplib `authenticator` surface on top
 * of otplib v13's functional API. Verification allows a one-step window in each
 * direction to tolerate real-world clock drift between the server and the
 * candidate's authenticator app.
 */
export const authenticator = {
  generateSecret(): string {
    return generateSecret();
  },
  keyuri(accountName: string, issuer: string, secret: string): string {
    return generateURI({ issuer, label: accountName, secret });
  },
  async check(token: string, secret: string): Promise<boolean> {
    try {
      // ponytail: ±1 time-step tolerance; widen only if drift complaints appear.
      const result = await verify({ secret, token, epochTolerance: 30 });
      return result.valid;
    } catch {
      return false;
    }
  },
};

/**
 * Record a mutating admin action. Never throws: a failed audit insert is logged
 * and swallowed so it can never fail the caller's request.
 */
export async function audit(
  adminId: string,
  action: string,
  target: string | null,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(auditLogs).values({ adminId, action, target, meta });
  } catch (error) {
    logger.warn({ err: error, action, target }, "audit log insert failed");
  }
}

/**
 * Rebuild the Redis leaderboard ZSET for an exam from the durable results table.
 * Used to self-heal when the cache is cold but graded results exist.
 */
export async function rebuildLeaderboard(examId: string): Promise<void> {
  const rows = await db
    .select({ participantId: results.participantId, score: results.score })
    .from(results)
    .where(eq(results.examId, examId));
  if (rows.length === 0) return;
  const args: (string | number)[] = [];
  for (const row of rows) {
    args.push(row.score, row.participantId);
  }
  await redis.zadd(`leaderboard:${examId}`, ...args);
}

/** Encode a single CSV field per RFC 4180 (quote when it contains , " CR or LF). */
export function csvField(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** ISO string, or null for absent timestamps. `csvField` maps null to "". */
export function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

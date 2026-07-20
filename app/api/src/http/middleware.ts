/**
 * Shared HTTP concerns: error type, JWT signing and verification for
 * participants and admins, zod body validation, and a Redis-backed
 * fixed-window rate limiter.
 */

import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import type { ZodType } from "zod";
import { db } from "../db/index.ts";
import { admins } from "../db/schema.ts";
import { env } from "../env.ts";
import { logger } from "../logger.ts";
import { redis } from "../redis.ts";

/** Throwable HTTP error; the error handler maps it to a JSON response. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// --- JWT ---------------------------------------------------------------

export interface ParticipantClaims {
  kind: "participant";
  sessionId: string;
  participantId: string;
  deviceId?: string;
}

export interface AdminClaims {
  kind: "admin";
  adminId: string;
  email: string;
}

export function signParticipantToken(claims: Omit<ParticipantClaims, "kind">): string {
  return jwt.sign({ ...claims, kind: "participant" }, env.JWT_SECRET, {
    expiresIn: env.SESSION_TOKEN_TTL_SECONDS,
  });
}

export function signAdminToken(claims: Omit<AdminClaims, "kind">): string {
  return jwt.sign({ ...claims, kind: "admin" }, env.JWT_SECRET, {
    expiresIn: env.ADMIN_TOKEN_TTL_SECONDS,
  });
}

function bearerToken(req: Request): string {
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) throw new HttpError(401, "Missing or malformed Authorization header");
  return token;
}

/** Request augmented by the auth middlewares. */
export interface AuthedRequest extends Request {
  participant?: ParticipantClaims;
  admin?: AdminClaims;
}

export function requireParticipant(req: AuthedRequest, _res: Response, next: NextFunction): void {
  try {
    const decoded = jwt.verify(bearerToken(req), env.JWT_SECRET) as ParticipantClaims;
    if (decoded.kind !== "participant") throw new HttpError(401, "Invalid token kind");
    req.participant = decoded;
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, "Invalid or expired session token"));
  }
}

export async function requireAdmin(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const decoded = jwt.verify(bearerToken(req), env.JWT_SECRET) as AdminClaims;
    if (decoded.kind !== "admin") throw new HttpError(401, "Invalid token kind");
    // The signature alone is not enough: a token minted before an admin was
    // deleted or reseeded must stop working, and downstream audit inserts
    // reference this id by foreign key.
    const [row] = await db
      .select({ id: admins.id })
      .from(admins)
      .where(eq(admins.id, decoded.adminId))
      .limit(1);
    if (!row) throw new HttpError(401, "Admin account no longer exists; sign in again");
    req.admin = decoded;
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, "Invalid or expired admin token"));
  }
}

// --- Validation ----------------------------------------------------------

/** Validate req.body against a zod schema; replaces body with the parsed value. */
export function validate<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      next(new HttpError(400, parsed.error.issues.map((i) => i.message).join("; ")));
      return;
    }
    req.body = parsed.data;
    next();
  };
}

// --- Rate limiting ---------------------------------------------------------

/**
 * Fixed-window rate limiter backed by Redis INCR + EXPIRE.
 * Fails open when Redis is unavailable: availability over strictness here;
 * the load balancer provides the outer safety net.
 *
 * Keys per client IP by default. That is wrong for authenticated traffic when
 * many candidates sit behind one NAT (an entire lab shares one public IP and
 * one bucket), so callers pass `key` to bucket per identity instead; a null
 * return falls back to the IP.
 */
export function rateLimit(options: {
  bucket: string;
  limit: number;
  windowSeconds: number;
  key?: (req: Request) => string | null;
}) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = options.key?.(req) ?? req.ip ?? "unknown";
      const key = `rl:${options.bucket}:${id}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, options.windowSeconds);
      if (count > options.limit) {
        next(new HttpError(429, "Too many requests. Slow down."));
        return;
      }
      next();
    } catch (error) {
      logger.warn({ err: error }, "rate limiter unavailable; failing open");
      next();
    }
  };
}

/**
 * Rate-limit key for candidate traffic: the participant id from a valid
 * bearer token, so each candidate gets their own bucket regardless of NAT.
 * The signature is verified (an unverified decode would let anyone mint
 * fresh buckets and bypass the limit); invalid or absent tokens fall back
 * to the IP bucket and are rejected by requireParticipant right after.
 */
export function participantRateKey(req: Request): string | null {
  const header = req.header("authorization") ?? "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as ParticipantClaims;
    if (decoded.kind !== "participant" || !decoded.participantId) return null;
    return `p:${decoded.participantId}`;
  } catch {
    return null;
  }
}

// --- Error handling ----------------------------------------------------

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  logger.error({ err, path: req.path }, "unhandled error");
  res.status(500).json({ error: "Internal server error" });
}

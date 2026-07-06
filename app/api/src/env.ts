/**
 * Environment configuration, validated once at startup. Every consumer imports
 * the parsed `env` object; nothing else reads process.env directly.
 */

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("postgres://wcl:wcl@localhost:5432/wcl"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  /** HMAC secret for session JWTs. MUST be overridden in production. */
  JWT_SECRET: z.string().default("dev-only-secret-change-me"),
  /** Participant session token lifetime. Longer than any exam duration. */
  SESSION_TOKEN_TTL_SECONDS: z.coerce.number().default(6 * 3600),
  /** Admin token lifetime. */
  ADMIN_TOKEN_TTL_SECONDS: z.coerce.number().default(12 * 3600),
  /**
   * Fast-clock test mode: exam time runs this many times faster than real
   * time (duration is divided by the multiplier at begin). 1 = real time.
   */
  CLOCK_MULTIPLIER: z.coerce.number().positive().default(1),
  DB_POOL_MAX: z.coerce.number().default(20),
  LOG_LEVEL: z.string().default("info"),
});

export const env = EnvSchema.parse(process.env);

export const isProduction = env.NODE_ENV === "production";

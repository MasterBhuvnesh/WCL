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
  /**
   * Number of reverse-proxy hops in front of the API (Express "trust proxy").
   * Production runs behind one AWS ALB, so req.ip must come from
   * X-Forwarded-For one hop back; otherwise every request appears to
   * originate from the load balancer and shares one rate-limit bucket.
   * Set 0 only if the API is exposed directly.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  LOG_LEVEL: z.string().default("info"),
  /**
   * Static bearer token for GET /metrics (Prometheus scrape). The ALB
   * forwards all paths to the API, so the endpoint must not be open.
   * Unset disables /metrics entirely.
   */
  METRICS_TOKEN: z.string().optional(),
  /**
   * Production bootstrap: on first boot against an empty database the API
   * creates this admin account and exam itself (see bootstrap() in index.ts),
   * so a clean deployment never needs manual SQL. Rows are only created when
   * missing — changing these values later does not update existing rows.
   */
  ADMIN_EMAIL: z.string().default("admin@wcl.local"),
  /** MUST be overridden in production; the server refuses the default. */
  ADMIN_PASSWORD: z.string().default("adminpass"),
  EXAM_ID: z.string().default("WCL-EXAM"),
  EXAM_TITLE: z.string().default("WCL Examination"),
  EXAM_DURATION_SECONDS: z.coerce.number().int().positive().default(3600),
  EXAM_QUESTIONS_TO_SERVE: z.coerce.number().int().positive().default(60),
  /** Common candidate password used by seed + import for rows without an explicit secret. */
  PARTICIPANT_PASSWORD: z.string().default("wclrbu2026"),
  /** S3-compatible image storage: Floci locally (any creds), real S3 via these in production. */
  S3_ENDPOINT: z.string().default("http://localhost:4566"),
  S3_BUCKET: z.string().default("wcl-images"),
  S3_ACCESS_KEY_ID: z.string().default("test"),
  S3_SECRET_ACCESS_KEY: z.string().default("test"),
  /** Public base URL for uploaded images; when unset it is derived (see s3PublicUrl). */
  S3_PUBLIC_URL: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);

/** Public base URL for uploaded images. Zod defaults can't cross-reference fields, so derive it here. */
export const s3PublicUrl = env.S3_PUBLIC_URL ?? `${env.S3_ENDPOINT}/${env.S3_BUCKET}`;

export const isProduction = env.NODE_ENV === "production";

// Refuse to boot a production instance on dev-only secrets.
if (isProduction) {
  const insecure = [
    env.JWT_SECRET === "dev-only-secret-change-me" && "JWT_SECRET",
    env.ADMIN_PASSWORD === "adminpass" && "ADMIN_PASSWORD",
  ].filter(Boolean);
  if (insecure.length > 0) {
    throw new Error(
      `Refusing to start with default ${insecure.join(" and ")} in production. Set real values in the environment.`,
    );
  }
}

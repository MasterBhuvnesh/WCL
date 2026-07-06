/**
 * Database client: postgres.js pool wrapped by Drizzle.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

export const pgClient = postgres(env.DATABASE_URL, {
  max: env.DB_POOL_MAX,
  onnotice: () => {},
});

export const db = drizzle(pgClient, { schema });

export { schema };

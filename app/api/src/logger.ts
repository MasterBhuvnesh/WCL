/**
 * Structured logging (pino). Pretty-printed in development, JSON in production.
 */

import pino from "pino";
import { env, isProduction } from "./env.ts";

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss" },
        },
      }),
});

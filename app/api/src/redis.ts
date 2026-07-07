/**
 * Redis clients. One shared command client; dedicated subscriber connections
 * are created on demand (a subscribing connection cannot issue commands).
 *
 * Key conventions:
 *   session:{sessionId}        JSON session cache (TTL: token lifetime)
 *   deadline:{sessionId}       deadline epoch millis (TTL past deadline)
 *   leaderboard:{examId}       sorted set: member participantId, score result score
 *   rl:{bucket}:{key}          fixed-window rate-limit counters
 *   idem:{key}                 idempotency guards
 * Pub/sub channels:
 *   wcl:leaderboard:{examId}   leaderboard updates for admin WebSocket fan-out
 *   wcl:session:{sessionId}    per-session pushes (e.g. add-time)
 */

import Redis from "ioredis";
import { env } from "./env.ts";
import { logger } from "./logger.ts";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  lazyConnect: false,
});

redis.on("error", (error) => {
  logger.error({ err: error }, "redis error");
});

/** Create a dedicated connection for pub/sub subscriptions. */
export function createSubscriber(): Redis {
  const sub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  sub.on("error", (error) => logger.error({ err: error }, "redis subscriber error"));
  return sub;
}

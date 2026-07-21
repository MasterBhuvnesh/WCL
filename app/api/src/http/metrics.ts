/**
 * Observability: RED metrics (prom-client) and per-request log lines.
 * See docs/OBSERVABILITY.md.
 *
 * Cardinality rule: participant/admin identifiers appear only as log fields
 * (Loki); Prometheus labels stay at method/route/status.
 */

import type { NextFunction, Request, Response } from "express";
import client from "prom-client";

import { env } from "../env.ts";
import { logger } from "../logger.ts";
import type { AuthedRequest } from "./middleware.ts";

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

/**
 * Observes every response (metrics + one pino info line). The route label is
 * the matched Express route template, not the raw URL, so path parameters
 * (session ids) never become label values; unmatched requests (404s) share
 * one "unmatched" series.
 */
export function requestObserver(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/metrics") return next(); // scraped every 15s; pure noise
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const route = req.route
      ? `${req.baseUrl}${req.route.path === "/" ? "" : String(req.route.path)}` || "/"
      : "unmatched";
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestDuration.observe(labels, durationMs / 1000);
    httpRequestsTotal.inc(labels);

    const { participant, admin } = req as AuthedRequest;
    logger.info(
      {
        method: req.method,
        route,
        path: req.path,
        status: res.statusCode,
        durationMs,
        ip: req.ip,
        ...(participant && {
          participantId: participant.participantId,
          sessionId: participant.sessionId,
        }),
        ...(admin && { adminId: admin.adminId }),
      },
      "request",
    );
  });
  next();
}

/**
 * GET /metrics: prom-client registry, guarded by a static bearer token
 * (METRICS_TOKEN). Unset token disables the endpoint entirely.
 */
export async function metricsHandler(req: Request, res: Response): Promise<void> {
  if (!env.METRICS_TOKEN) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (req.header("authorization") !== `Bearer ${env.METRICS_TOKEN}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.set("Content-Type", register.contentType);
  res.send(await register.metrics());
}

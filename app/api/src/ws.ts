/**
 * Admin live WebSocket. A single Redis subscriber (PSUBSCRIBE wcl:*) fans out
 * every published message to all connected admin sockets as
 * {channel, payload}. Upgrades are accepted only on /admin/ws and only for a
 * valid admin JWT supplied as a ?token= query parameter.
 */

import type http from "node:http";
import jwt from "jsonwebtoken";
import { WebSocket, WebSocketServer } from "ws";
import { env } from "./env.ts";
import { logger } from "./logger.ts";
import { createSubscriber } from "./redis.ts";

/** WebSocket carrying the keepalive liveness flag. */
interface AliveSocket extends WebSocket {
  isAlive?: boolean;
}

export function attachAdminWs(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== "/admin/ws") return; // Not ours; leave the socket alone.

    const token = url.searchParams.get("token") ?? "";
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as { kind?: string };
      if (decoded.kind !== "admin") throw new Error("not an admin token");
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: AliveSocket) => {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
  });

  // Single subscriber for all admin sockets; broadcast every wcl:* message.
  const subscriber = createSubscriber();
  subscriber.psubscribe("wcl:*").catch((error) => {
    logger.error({ err: error }, "admin ws: PSUBSCRIBE wcl:* failed");
  });
  subscriber.on("pmessage", (_pattern, channel, message) => {
    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      payload = message;
    }
    const frame = JSON.stringify({ channel, payload });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(frame);
    }
  });

  // Keepalive: ping every 30s, terminate sockets that missed the last pong.
  const keepalive = setInterval(() => {
    for (const client of wss.clients as Set<AliveSocket>) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 30_000);
  keepalive.unref();
}

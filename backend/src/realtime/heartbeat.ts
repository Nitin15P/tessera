import type { WebSocketServer } from "ws";
import { limits } from "../config/env";

/**
 * Dead-socket detection.
 *
 * A socket that dies without a close frame — laptop lid, tunnel drop, tab
 * suspended — otherwise lingers indefinitely, and its owner stays in the
 * presence list looking online. TCP will not tell us; only silence will.
 *
 * Ping every 30s and terminate anything that missed the previous round. The flag
 * lives on the ws object rather than our Connection because a socket can fail
 * the handshake before a Connection exists for it.
 */
type Tracked = { isAlive?: boolean };

export function start(wss: WebSocketServer): () => void {
  wss.on("connection", (ws) => {
    const t = ws as typeof ws & Tracked;
    t.isAlive = true;
    ws.on("pong", () => (t.isAlive = true));
  });

  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      const t = ws as typeof ws & Tracked;
      if (t.isAlive === false) {
        ws.terminate();
        continue;
      }
      t.isAlive = false;
      ws.ping();
    }
  }, limits.heartbeatMs);

  return () => clearInterval(timer);
}

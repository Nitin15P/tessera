import type { ServerResponse } from "node:http";
import { isEnabled } from "../db/postgres";
import { isReady } from "../services/board.service";
import { broadcaster } from "../realtime";

/**
 * Liveness for the platform's health check.
 *
 * Reports 503 until the board has hydrated. That matters during a rolling
 * deploy: an instance that is listening but hasn't read the grid yet would
 * happily hand a new connection an empty board, and the client would believe it.
 * Better to be unrouteable for a second than to be confidently wrong.
 *
 * `durableLog: false` is reported but is *not* a failure — Postgres being absent
 * is a supported state, not an outage.
 */
export function health(res: ServerResponse): void {
  const ok = isReady();
  res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      ok,
      connections: broadcaster.count(),
      players: broadcaster.onlinePlayers().length,
      durableLog: isEnabled(),
    }),
  );
}

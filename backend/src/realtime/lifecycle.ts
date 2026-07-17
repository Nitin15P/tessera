import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import {
  CLAIM_BUCKET_MAX,
  CLAIM_REFILL_MS,
  GRID_H,
  GRID_W,
} from "@tessera/shared/protocol";
import { compose, errorBoundary, parseAndValidate, rateLimit } from "../middleware";
import { limits } from "../config/env";
import { isReady } from "../services/board.service";
import * as players from "../services/player.service";
import { add, remove, sendSnapshot, toPublic } from "./broadcaster";
import { createConnection, send } from "./connection";
import { dispatch } from "./dispatch";
import { markCursorGone } from "./ticker";

/**
 * Connection lifecycle.
 *
 * The ordering in `open` is the whole point, and it is the one thing in this
 * file that must not be rearranged for tidiness:
 *
 *   register for broadcasts  ->  then read the snapshot
 *
 * Do it the other way and a claim landing in the gap is never sent to this
 * connection and never will be — they sit on a silently wrong board until they
 * refresh, with nothing to indicate anything went wrong. Registering first makes
 * the worst case a duplicate update, which is idempotent and free.
 */

const pipeline = compose([errorBoundary, rateLimit, parseAndValidate, dispatch]);

export async function open(ws: WebSocket, req: IncomingMessage): Promise<void> {
  // The board must exist before anyone can be told about it, or they'd get a
  // snapshot of an empty grid and believe it.
  if (!isReady()) {
    ws.close(1013, "warming up");
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const token = url.searchParams.get("token") ?? undefined;

  const { player, token: resolvedToken } = await players.resolve(token);
  const conn = createConnection(ws, player);
  conn.mw.budget = limits.msgsPerSecond;
  conn.mw.windowStartedAt = Date.now();

  // 1. Subscribe.
  add(conn);

  send(ws, {
    t: "welcome",
    you: toPublic(player),
    w: GRID_W,
    h: GRID_H,
    bucketMax: CLAIM_BUCKET_MAX,
    refillMs: CLAIM_REFILL_MS,
    token: resolvedToken,
  });

  // 2. Then read.
  sendSnapshot(conn);

  ws.on("message", (raw) => {
    void pipeline({ conn, raw: raw.toString() });
  });

  ws.on("pong", () => (conn.alive = true));

  ws.on("close", () => {
    remove(conn);
    // Their cursor should vanish for everyone, not freeze where they left it.
    markCursorGone(player.idx);
  });

  ws.on("error", (err) => console.error(`[ws] socket error (${player.name}):`, err));

  console.log(`[ws] + ${player.name} (idx ${player.idx})`);
}

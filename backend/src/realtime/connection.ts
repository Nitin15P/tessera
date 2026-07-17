import type { WebSocket } from "ws";
import type { PlayerIdx, ServerMsg } from "@tessera/shared";
import type { MiddlewareState } from "../middleware/types";
import type { PlayerRecord } from "../services/player.service";

/**
 * One connected socket, and everything we track about it.
 *
 * Named `Connection` rather than `Client` deliberately: a player may have two
 * tabs open, so this is a connection, not a person. Conflating the two is how
 * presence lists start double-counting.
 */
export interface Connection {
  ws: WebSocket;
  player: PlayerRecord;

  /**
   * Player indices this socket already has colours for. A patch can reference
   * someone who joined after this connection's snapshot, so identities ship
   * just-in-time rather than the client having to ask.
   */
  seen: Set<PlayerIdx>;

  cursor: [number, number] | null;

  /** Owned by middleware; handlers must not touch it. */
  mw: MiddlewareState;

  /** Heartbeat liveness — see realtime/heartbeat. */
  alive: boolean;
}

export function createConnection(ws: WebSocket, player: PlayerRecord): Connection {
  return {
    ws,
    player,
    seen: new Set(),
    cursor: null,
    mw: { budget: Infinity, windowStartedAt: 0 },
    alive: true,
  };
}

/**
 * The only place a ServerMsg becomes bytes.
 *
 * Guards readyState because a socket can close between a tick deciding to write
 * and the write happening, and `send` on a closing socket throws.
 */
export function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}

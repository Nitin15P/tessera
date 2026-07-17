import type { CursorMsg } from "@tessera/shared/protocol";
import type { Connection } from "../connection";
import { markCursor } from "../ticker";

/**
 * Cursor movement. Fire-and-forget: no acknowledgement, no persistence, and
 * cheapest thing in the app. Coordinates are already range-checked by middleware.
 */
export function handleCursor(conn: Connection, msg: CursorMsg): void {
  conn.cursor = [msg.x, msg.y];
  markCursor(conn.player.idx, msg.x, msg.y);
}

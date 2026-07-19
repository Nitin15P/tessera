import type { SetProfileMsg } from "@tessera/shared/protocol";
import { sanitizeColor } from "@tessera/shared/domain";
import { sanitizeName } from "../../domain/names";
import * as players from "../../services/player.service";
import { broadcastPlayer, toPublic } from "../broadcaster";
import type { Connection } from "../connection";

/**
 * A player set their own name and colour.
 *
 * The two values arrived over a socket, so neither is trusted: the name is cleaned
 * and capped, and the colour is pulled into the board-readable band, before either
 * is stored. Then the sanitised identity is broadcast so every client — including
 * this one — converges on exactly what the server kept, rather than on whatever the
 * client optimistically drew. No reply is sent; the broadcast is the reply.
 */
export async function handleSetProfile(conn: Connection, msg: SetProfileMsg): Promise<void> {
  const name = sanitizeName(msg.name);
  const color = sanitizeColor(msg.color);

  const updated = await players.updateProfile(conn.player.idx, name, color);
  broadcastPlayer(toPublic(updated));
}

import { encodeGrid } from "@tessera/shared/protocol";
import type { PlayerIdx, PublicPlayer } from "@tessera/shared/domain";
import { type Connection, send } from "./connection";
import { currentSeq, snapshot } from "../services/board.service";
import * as players from "../services/player.service";
import type { PlayerRecord } from "../services/player.service";

/**
 * The connection registry, and outbound composition.
 *
 * Split from the ticker on purpose: this file knows *who* is connected and *how*
 * to address them; the ticker knows *when*. They used to be one file called
 * "hub", which is a name that means nothing and was a fair sign the two
 * responsibilities had grown together.
 */

const connections = new Set<Connection>();

export const add = (c: Connection): void => void connections.add(c);
export const all = (): Iterable<Connection> => connections;
export const count = (): number => connections.size;

/**
 * Distinct *players* online, not sockets — two tabs is one person, and a
 * presence list that says otherwise is just wrong. Connections only: this is the
 * signal the bot reads to know whether any *human* is here, so it must never
 * count the bot itself.
 */
export function onlinePlayers(): PlayerIdx[] {
  return [...new Set([...connections].map((c) => c.player.idx))];
}

/**
 * The resident bot has no connection, so it would never appear online on its own.
 * app.ts registers a provider that names the bot's index while it is actually
 * playing, and presence is broadcast from `onlineWithBot()` so people see it in
 * the room. Kept out of `onlinePlayers()` on purpose — that one must stay humans.
 */
let botPresence: (() => PlayerIdx | null) | null = null;
export const setBotPresence = (fn: () => PlayerIdx | null): void => void (botPresence = fn);

export function onlineWithBot(): PlayerIdx[] {
  const list = onlinePlayers();
  const idx = botPresence?.() ?? null;
  return idx !== null && !list.includes(idx) ? [...list, idx] : list;
}

export const remove = (c: Connection): void => void connections.delete(c);

export const toPublic = (p: PlayerRecord): PublicPlayer => ({
  idx: p.idx,
  name: p.name,
  color: p.color,
});

/**
 * The whole board as one base64 blob, plus every identity needed to colour it.
 * 1500 tiles is ~4KB on the wire.
 */
export function sendSnapshot(c: Connection): void {
  const known = players.known();
  for (const p of known) c.seen.add(p.idx);

  send(c.ws, {
    t: "snapshot",
    seq: currentSeq(),
    grid: encodeGrid(snapshot()),
    players: known.map(toPublic),
  });
}

/**
 * Re-send a fresh snapshot to everyone. Called after a reset re-hydrate (Redis
 * flushed or restarted), where connected clients would otherwise be left showing
 * pre-reset state. A snapshot is idempotent on the client, so this is safe even
 * for clients that happened to already be correct.
 */
export function resyncAll(): void {
  for (const c of connections) {
    if (c.ws.readyState === c.ws.OPEN) sendSnapshot(c);
  }
}

/**
 * Announce a race winner to everyone. The winner's identity rides in the message
 * so a client can name and colour the banner without having seen them before —
 * the winner might be a stranger on this recipient's board. The blank board
 * follows immediately behind as a fresh snapshot; the client shows this over it.
 */
export function broadcastGameOver(winner: PublicPlayer, score: number): void {
  for (const c of connections) {
    if (c.ws.readyState === c.ws.OPEN) send(c.ws, { t: "gameOver", winner, score });
  }
}

/**
 * Identities for any player a message mentions that this connection can't
 * colour yet. Usually empty — it only costs anything the first time a new
 * player appears on someone's board.
 */
export async function unseenPlayers(
  c: Connection,
  indices: Iterable<PlayerIdx>,
): Promise<PublicPlayer[]> {
  const out: PublicPlayer[] = [];
  for (const idx of indices) {
    if (idx === 0 || c.seen.has(idx)) continue;
    const p = players.getCached(idx) ?? (await players.get(idx));
    if (p) {
      out.push(toPublic(p));
      c.seen.add(idx);
    }
  }
  return out;
}

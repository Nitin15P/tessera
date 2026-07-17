import { TICK_MS } from "@tessera/shared/protocol";
import type { PlayerIdx } from "@tessera/shared/domain";
import { limits } from "../config/env";
import { leaderboardRepo } from "../db/redis";
import { onUpdate, currentSeq } from "../services/board.service";
import { all, count, onlinePlayers, unseenPlayers } from "./broadcaster";
import { send } from "./connection";

/**
 * When things go out.
 *
 * The central idea: never send a message per event. Changes are coalesced onto a
 * 50ms tick (20Hz) and flushed as one patch.
 *
 * With 30 people clicking hard, per-event delivery is ~300 tiny frames/sec at
 * every client. Batching bounds it to 20/sec regardless of how busy the board
 * gets, and a tile touched five times inside one window costs the same as a tile
 * touched once — only the final owner ships. Load stops being a function of how
 * frantic the players are.
 *
 * 50ms sits under the threshold where a change stops reading as instant, while
 * still being long enough to actually collect something worth coalescing.
 */

/** cell -> owner, deduped within the window. Last write wins. */
let dirtyCells = new Map<number, PlayerIdx>();
/** playerIdx -> position, deduped the same way. */
let dirtyCursors = new Map<PlayerIdx, [number, number]>();
/** Departed players, published once at an off-board coordinate. */
const goneCursors = new Set<PlayerIdx>();

export function markCursor(idx: PlayerIdx, x: number, y: number): void {
  dirtyCursors.set(idx, [x, y]);
}

export function markCursorGone(idx: PlayerIdx): void {
  dirtyCursors.delete(idx);
  goneCursors.add(idx);
}

// The mirror advancing is the *only* thing that marks the board dirty, so a
// change made on another instance and a change made here take exactly the same
// path out to clients. There is no local shortcut that could drift.
onUpdate((u) => void dirtyCells.set(u.cell, u.owner));

async function fastFlush(): Promise<void> {
  if (dirtyCells.size === 0 && dirtyCursors.size === 0 && goneCursors.size === 0) return;

  const cells = [...dirtyCells.entries()] as [number, PlayerIdx][];
  const owners = new Set(dirtyCells.values());
  const cursors = [...dirtyCursors.entries()].map(
    ([idx, [x, y]]) => [idx, x, y] as [PlayerIdx, number, number],
  );
  // Off-board coordinates read as "remove" on the client, which avoids a whole
  // extra message type for a rare event.
  for (const idx of goneCursors) cursors.push([idx, -1, -1]);

  dirtyCells = new Map();
  dirtyCursors = new Map();
  goneCursors.clear();

  const seq = currentSeq();

  for (const c of all()) {
    if (c.ws.readyState !== c.ws.OPEN) continue;

    if (cells.length) {
      const players = await unseenPlayers(c, owners);
      send(c.ws, { t: "patch", seq, cells, ...(players.length ? { players } : {}) });
    }

    if (cursors.length) {
      // Filtered here rather than client-side: a connection is never told about
      // its own cursor, because it already knows where its mouse is.
      const others = cursors.filter(([idx]) => idx !== c.player.idx);
      if (others.length) send(c.ws, { t: "cursors", c: others });
    }
  }
}

/**
 * Presence and leaderboard change slowly and nobody is watching for 50ms
 * precision on them, so they ride a lazier timer.
 */
async function slowFlush(): Promise<void> {
  if (count() === 0) return;

  const online = onlinePlayers();
  const top = await leaderboardRepo.top(10);

  // The board can reference players who have since left, so the leaderboard is a
  // second place a client can meet an index it has no colour for.
  for (const c of all()) {
    if (c.ws.readyState !== c.ws.OPEN) continue;

    const players = await unseenPlayers(
      c,
      top.map((t) => t.idx),
    );
    if (players.length) {
      send(c.ws, { t: "patch", seq: currentSeq(), cells: [], players });
    }
    send(c.ws, { t: "presence", online });
    send(c.ws, { t: "leaderboard", top });
  }
}

let fast: ReturnType<typeof setInterval> | null = null;
let slow: ReturnType<typeof setInterval> | null = null;

export function start(): void {
  fast ??= setInterval(() => void fastFlush().catch(console.error), TICK_MS);
  slow ??= setInterval(() => void slowFlush().catch(console.error), limits.slowTickMs);
}

export function stop(): void {
  if (fast) clearInterval(fast);
  if (slow) clearInterval(slow);
  fast = slow = null;
}

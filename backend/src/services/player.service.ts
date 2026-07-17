import { randomUUID } from "node:crypto";
import { colorFor, type PlayerIdx } from "@tessera/shared/domain";
import { playerRepo } from "../db/redis";
import type { PlayerRecord } from "../db/redis/repositories/player.repository";
import { playerRepo as pgPlayerRepo } from "../db/postgres";
import { redis } from "../db/redis";
import { K } from "../db/redis/keys";
import { generateName } from "../domain/names";
import { recordPlayer } from "./eventLog.service";

export type { PlayerRecord };

/**
 * Identity, with no signup.
 *
 * A browser gets a token on first visit and keeps it in localStorage. That token
 * is the whole auth story, and the honest framing is that it identifies a
 * *browser*, not a person: clear storage and you're someone new; copy the token
 * and you're the same player. For a public board with nothing at stake that is
 * the right amount of security, and saying so plainly beats implying more.
 */

/**
 * idx -> player, warmed at boot and filled lazily. A player created on another
 * backend instance is unknown here until we first see their index, at which
 * point we fetch once and keep it.
 *
 * Bounded by lifetime players, which is fine at this scale. A long-lived
 * deployment would want an LRU — noted rather than built.
 */
const cache = new Map<PlayerIdx, PlayerRecord>();

export async function warm(): Promise<void> {
  for (const p of await playerRepo.findAll()) cache.set(p.idx, p);
  console.log(`[players] warmed ${cache.size}`);
}

/**
 * Realign Redis's index allocator with history.
 *
 * If Redis was flushed but Postgres wasn't, the allocator restarts at 1 and
 * would hand out indices that historical claims already refer to — silently
 * attributing one player's tiles to another in the log. Only runs when the
 * durable store is actually present.
 */
export async function reconcileIdxAllocator(): Promise<void> {
  const highest = await pgPlayerRepo.maxIdx();
  if (highest === 0) return;

  const current = Number((await redis.get(K.playerSeq)) ?? 0);
  if (current >= highest) return;

  await redis.set(K.playerSeq, String(highest));
  console.warn(
    `[players] allocator was at ${current} but history reaches ${highest} — realigned`,
  );
}

export const getCached = (idx: PlayerIdx): PlayerRecord | null => cache.get(idx) ?? null;
export const known = (): PlayerRecord[] => [...cache.values()];

/** Fetch-through. Null only if the index genuinely doesn't exist. */
export async function get(idx: PlayerIdx): Promise<PlayerRecord | null> {
  const hit = cache.get(idx);
  if (hit) return hit;

  const found = await playerRepo.findByIdx(idx);
  if (found) cache.set(idx, found);
  return found;
}

/**
 * Resolve a returning browser, or mint a new player.
 *
 * A token that no longer resolves (Redis was flushed) mints a fresh identity
 * rather than erroring — the board is gone in that case anyway.
 */
export async function resolve(
  token: string | undefined,
): Promise<{ player: PlayerRecord; token: string }> {
  if (token) {
    const idx = await playerRepo.findIdxByToken(token);
    if (idx !== null) {
      const existing = await get(idx);
      if (existing) return { player: existing, token };
    }
  }

  const newToken = token ?? randomUUID();
  const idx = await playerRepo.nextPlayerIdx();

  const player: PlayerRecord = {
    idx,
    id: randomUUID(),
    name: generateName(),
    color: colorFor(idx),
  };

  await playerRepo.insert(player, newToken);
  cache.set(idx, player);

  // Durable mirror, fire-and-forget. Never awaited: identity resolution happens
  // during the handshake, and a sleeping database must not delay a connection.
  recordPlayer(player);

  return { player, token: newToken };
}

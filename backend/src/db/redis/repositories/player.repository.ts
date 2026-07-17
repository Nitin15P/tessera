import type { PlayerIdx, PublicPlayer } from "@tessera/shared/domain";
import { redis } from "../client";
import { K } from "../keys";

/** The stored shape. `id` is the durable uuid; `idx` is what travels on the wire. */
export interface PlayerRecord extends PublicPlayer {
  id: string;
}

/**
 * Allocate the next player index.
 *
 * INCR is atomic, so two simultaneous first-visits cannot collide — which
 * matters, because the index *is* the identity on the wire. A duplicate would
 * mean two people sharing one colour and one leaderboard row.
 */
export const nextPlayerIdx = (): Promise<number> => redis.incr(K.playerSeq);

export async function findIdxByToken(token: string): Promise<number | null> {
  const idx = await redis.get(K.token(token));
  return idx === null ? null : Number(idx);
}

export async function findByIdx(idx: PlayerIdx): Promise<PlayerRecord | null> {
  const json = await redis.hget(K.players, String(idx));
  if (!json) return null;
  try {
    return JSON.parse(json) as PlayerRecord;
  } catch {
    console.warn(`[players] unreadable record at idx ${idx}`);
    return null;
  }
}

export async function findAll(): Promise<PlayerRecord[]> {
  const all = await redis.hgetall(K.players);
  const out: PlayerRecord[] = [];
  for (const [idx, json] of Object.entries(all)) {
    try {
      out.push(JSON.parse(json) as PlayerRecord);
    } catch {
      console.warn(`[players] skipping unreadable record at idx ${idx}`);
    }
  }
  return out;
}

/** Identity and token binding written together, so a player can never exist
 *  without a way to return as them. */
export async function insert(player: PlayerRecord, token: string): Promise<void> {
  await redis
    .multi()
    .hset(K.players, String(player.idx), JSON.stringify(player))
    .set(K.token(token), String(player.idx))
    .exec();
}

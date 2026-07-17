import type { LeaderboardEntry } from "@tessera/shared/domain";
import { redis } from "../client";
import { K } from "../keys";

/**
 * Read-only. Scores are *written* inside the claim script (ZINCRBY, in the same
 * atomic unit as the tile), never here — which is precisely why the standings
 * can't drift from the board. There is deliberately no `increment` export: a
 * second place that could write scores would be a second place they could go
 * wrong.
 */
export async function top(n = 10): Promise<LeaderboardEntry[]> {
  const raw = await redis.zrevrange(K.leaderboard, 0, n - 1, "WITHSCORES");
  const out: LeaderboardEntry[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    out.push({ idx: Number(raw[i]), score: Number(raw[i + 1]) });
  }
  return out;
}

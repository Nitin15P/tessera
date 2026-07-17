import { pool } from "../pool";

/**
 * The append-only claim log. Never updated, never deleted.
 *
 * Writes are batched by the caller (services/eventLog.service) and arrive here
 * as arrays. Using `unnest` turns a batch of 500 into a single statement with
 * six parameters instead of 500 round trips — the difference between the log
 * being free and the log being a bottleneck.
 */

export interface ClaimRow {
  seq: number;
  cell: number;
  playerId: string;
  playerIdx: number;
  /** 0 means the tile was unclaimed: settlement, not a steal. */
  prevOwner: number;
  stolen: boolean;
}

export async function insertMany(rows: ClaimRow[]): Promise<void> {
  if (!pool || rows.length === 0) return;

  await pool.query(
    `insert into claims (seq, cell, player_id, player_idx, prev_player_idx, stolen)
     select * from unnest(
       $1::bigint[], $2::int[], $3::uuid[], $4::int[], $5::int[], $6::bool[]
     )`,
    [
      rows.map((r) => r.seq),
      rows.map((r) => r.cell),
      rows.map((r) => r.playerId),
      rows.map((r) => r.playerIdx),
      rows.map((r) => r.prevOwner),
      rows.map((r) => r.stolen),
    ],
  );
}

/**
 * The timelapse, if it were built: board state at any instant is a fold over
 * this in seq order. Left here to make the point concrete — the replay UI is a
 * read of data that already exists, not a feature that needs designing.
 */
export async function readSince(seq: number, limit = 5000): Promise<ClaimRow[]> {
  if (!pool) return [];
  const { rows } = await pool.query(
    `select seq, cell, player_id as "playerId", player_idx as "playerIdx",
            prev_player_idx as "prevOwner", stolen
       from claims where seq > $1 order by seq asc limit $2`,
    [seq, limit],
  );
  return rows as ClaimRow[];
}

import { pool } from "../pool";

/**
 * Durable mirror of identity. Redis is what the game runs on; this exists so the
 * log has someone to point at later, and so indices survive a flush.
 */

export interface PlayerRow {
  id: string;
  idx: number;
  name: string;
  color: string;
}

export async function upsertMany(rows: PlayerRow[]): Promise<void> {
  if (!pool || rows.length === 0) return;

  await pool.query(
    `insert into players (id, idx, name, color)
     select * from unnest($1::uuid[], $2::int[], $3::text[], $4::text[])
     on conflict (id) do update set last_seen_at = now()`,
    [
      rows.map((r) => r.id),
      rows.map((r) => r.idx),
      rows.map((r) => r.name),
      rows.map((r) => r.color),
    ],
  );
}

/**
 * Highest index ever issued. Used to rehydrate Redis's allocator after a flush
 * so a new player can never be handed an index that a historical claim already
 * refers to.
 */
export async function maxIdx(): Promise<number> {
  if (!pool) return 0;
  const { rows } = await pool.query(`select coalesce(max(idx), 0) as max from players`);
  return Number(rows[0]?.max ?? 0);
}

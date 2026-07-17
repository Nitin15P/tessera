import { limits } from "../config/env";
import { isEnabled } from "../db/postgres";
import { claimLogRepo, playerRepo } from "../db/postgres";
import type { ClaimRow } from "../db/postgres/repositories/claimLog.repository";
import type { PlayerRow } from "../db/postgres/repositories/player.repository";

/**
 * The durable log's write path. Deliberately the least important code here.
 *
 * Two properties matter, and both are about what this *cannot* do:
 *
 *  1. It cannot slow a claim. `recordClaim` is synchronous, does no I/O, and
 *     returns immediately. Writes leave on a timer, batched.
 *  2. It cannot take a claim down. Every failure path ends in a log line, never
 *     a throw.
 *
 * Losing log entries is acceptable. Losing a claim is not.
 */

let claims: ClaimRow[] = [];
let players = new Map<string, PlayerRow>();
let dropped = 0;
let timer: ReturnType<typeof setInterval> | null = null;

export function recordClaim(row: ClaimRow): void {
  if (!isEnabled()) return;

  // Back-pressure. If the database is unreachable this queue must not become a
  // memory leak; shedding the oldest keeps the recent history, which is the part
  // anyone would actually look at.
  if (claims.length >= limits.logMaxBatch * 4) {
    claims.shift();
    dropped++;
  }
  claims.push(row);
}

export function recordPlayer(row: PlayerRow): void {
  if (!isEnabled()) return;
  players.set(row.id, row);
}

async function flush(): Promise<void> {
  if (!isEnabled()) return;
  if (claims.length === 0 && players.size === 0) return;

  const playerBatch = [...players.values()];
  const claimBatch = claims.slice(0, limits.logMaxBatch);
  players = new Map();
  claims = claims.slice(limits.logMaxBatch);

  try {
    // Players first — not for referential integrity (there are no FKs; see
    // 001_init.sql) but so a reader joining claims to players rarely misses.
    await playerRepo.upsertMany(playerBatch);
    await claimLogRepo.insertMany(claimBatch);

    if (dropped) {
      console.warn(`[log] dropped ${dropped} events under back-pressure`);
      dropped = 0;
    }
  } catch (err) {
    // Swallowed on purpose. The board is unaffected, and retrying a poisoned
    // batch forever would guarantee the queue never drains.
    console.error("[log] batch failed, discarding:", (err as Error).message);
  }
}

export function start(): void {
  if (!isEnabled()) return;
  timer ??= setInterval(() => void flush(), limits.logFlushMs);
}

export async function stop(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  // Best-effort, but there's no reason to throw away what we already have.
  await flush().catch(() => {});
}

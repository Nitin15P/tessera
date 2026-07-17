import pg from "pg";
import { env } from "../../config/env";

/**
 * Postgres, optional by construction.
 *
 * Nothing on the claim path touches this. If DATABASE_URL is unset, the pool is
 * null and every write through it becomes a no-op — the board keeps working and
 * only the durable log stops recording.
 *
 * That is a design property, not a dev convenience. Supabase's free tier pauses
 * a project after seven days idle, so for a submission a reviewer might open in
 * a fortnight, *degraded* is the expected state. Losing log entries is
 * acceptable; losing a claim is not. Everything here follows from that asymmetry.
 */

export const pool: pg.Pool | null = env.databaseUrl
  ? new pg.Pool({
      connectionString: env.databaseUrl,
      max: 4,
      // Fail fast rather than piling up connections against a sleeping host.
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      ...(env.databaseUrl.includes("supabase.co")
        ? { ssl: { rejectUnauthorized: false } }
        : {}),
    })
  : null;

if (!pool) {
  console.warn("[db] DATABASE_URL unset — running without the durable log");
}

// An idle-client error must never reach an unhandled rejection: a dead database
// is a degraded feature, not a reason to take the board down.
pool?.on("error", (err) => console.error("[db] pool error:", err.message));

export const isEnabled = (): boolean => pool !== null;

export async function closePostgres(): Promise<void> {
  await pool?.end().catch(() => {});
}

import { fileURLToPath } from "node:url";

/**
 * Environment, parsed once, at the edge.
 *
 * Previously `process.env` was read in three different files, which meant there
 * was no single place to see what the service needs, and a typo'd variable name
 * surfaced as a confusing runtime failure somewhere deep in a repository. Parsed
 * here, everything downstream takes typed values and cannot ask for a variable
 * that doesn't exist.
 */

// Local-dev convenience: load backend/.env before anything reads process.env.
// Resolved relative to THIS file (not cwd), so it works no matter where the
// process was launched from. Node's loadEnvFile never overrides variables that
// are already set, so in production (Railway) — where the platform injects the
// vars and there is no .env file — the missing-file throw is simply ignored and
// the real environment wins. Kept dependency-free on purpose.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  /* no .env file (production, or local without one) — fine, use real env + defaults */
}

const str = (key: string, fallback?: string): string => {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${key}`);
  return v;
};

const int = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${key} must be an integer, got "${raw}"`);
  return n;
};

const bool = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  return raw !== "false" && raw !== "0";
};

export interface Env {
  port: number;
  redisUrl: string;
  /**
   * Optional by design. Postgres is never on the claim path, so its absence
   * degrades the durable log and nothing else — see db/postgres/pool.ts.
   */
  databaseUrl: string | null;
  isProduction: boolean;
  /**
   * Whether the resident bot plays. On by default — it's part of the live game.
   * The integration tests drive a real server over a socket and assert on exact
   * tiles, so a bot claiming in the background would make `steal`/`edge`/`win`
   * flaky; a test server is started with `BOT_ENABLED=false` to keep the board
   * quiet, the same reason those tests want a room with nobody else in it.
   */
  botEnabled: boolean;
}

export const env: Env = {
  port: int("PORT", 8080),
  redisUrl: str("REDIS_URL", "redis://localhost:6379"),
  databaseUrl: process.env["DATABASE_URL"] || null,
  isProduction: process.env["NODE_ENV"] === "production",
  botEnabled: bool("BOT_ENABLED", true),
};

/**
 * Limits that are ours rather than the game's.
 *
 * Kept apart from the shared game constants deliberately: these protect the
 * process, and changing one is an ops decision. Changing a game rule is a design
 * decision, and that lives in `shared/protocol/constants`.
 */
export const limits = {
  /** Inbound messages per connection per second. ~20Hz cursors plus input
   *  leaves plenty of headroom; this exists to stop a socket drowning the
   *  process in parse work, not to enforce a rule. */
  msgsPerSecond: 120,
  /** Presence and leaderboard cadence. Nobody needs 50ms precision on these. */
  slowTickMs: 1000,
  /** Dead-socket detection. */
  heartbeatMs: 30_000,
  /** Event-log batching. */
  logFlushMs: 1000,
  logMaxBatch: 500,
} as const;

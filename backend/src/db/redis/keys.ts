/**
 * Every Redis key the app touches, in one place, so the shape of the live state
 * is legible without grepping for string literals.
 */
export const K = {
  /** Hash: cell index -> player index. The board. */
  grid: "grid",
  /** Counter: bumped on every state change. The ordering backbone. */
  seq: "seq",
  /** ZSet: player index -> tiles held. Maintained inside the claim script
   *  itself, so it cannot drift from the board. */
  leaderboard: "lb",
  /** Counter: allocates dense player indices. */
  playerSeq: "playerSeq",
  /** Hash: player index -> JSON identity. */
  players: "players",
  /** Hash with TTL: {c: charges, t: last refill ms}. TTL is the full refill
   *  time, so an expired bucket and a full bucket are the same thing — the
   *  garbage collection is the semantics. */
  bucket: (playerId: string) => `bk:${playerId}`,
  /** Hash with TTL: the player's one outstanding challenge. */
  challenge: (playerId: string) => `ch:${playerId}`,
  /** String: browser token -> player index. */
  token: (token: string) => `ptok:${token}`,
  /** Short-lived lock so a race is reset exactly once, even if two players cross
   *  the target in the same millisecond. Held for a couple of seconds, then gone. */
  resetLock: "reset:lock",
  /** Renewable lock naming the one instance that drives the resident bot, so two
   *  instances can't double its speed. Expires on its own if that instance dies. */
  botLock: "bot:lock",
} as const;

/**
 * Fan-out channel. Every backend instance subscribes, so any instance can serve
 * any socket and none of them need to know the others exist.
 */
export const UPDATES_CHANNEL = "tessera:updates";

/**
 * Intentional game events (a race was won, the board was reset), separate from
 * the per-tile update stream. Kept apart so a deliberate reset rides a clean
 * signal every instance can act on, rather than being inferred from the
 * seq-regression self-heal that exists for Redis actually crashing.
 */
export const CONTROL_CHANNEL = "tessera:control";

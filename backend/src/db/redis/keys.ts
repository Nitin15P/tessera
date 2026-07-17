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
} as const;

/**
 * Fan-out channel. Every backend instance subscribes, so any instance can serve
 * any socket and none of them need to know the others exist.
 */
export const UPDATES_CHANNEL = "tessera:updates";

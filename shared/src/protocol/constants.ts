/**
 * Values both sides must agree on exactly.
 *
 * These are shared rather than duplicated because a disagreement here is not a
 * bug that shows up as an error — it shows up as two clients quietly drawing
 * different boards, which is the one failure mode this project exists to avoid.
 */

export const GRID_W = 20;
export const GRID_H = 20;
export const CELL_COUNT = GRID_W * GRID_H; // 400

/**
 * The race target: the first player *holding* this many tiles at once wins the
 * board instantly, and the game resets. Enough tiles to mark a clear leader,
 * while the board stays large enough (~12% of it) that reaching 50 is realistic
 * even when the room is crowded and rivals are stealing tiles back off you — a
 * smaller board makes that share a knife-fight nobody can hold. Fixed rather than
 * scaled to player count: one honest number everyone races toward. Both sides
 * share it so the client can render "distance to win" against the goal the
 * server enforces.
 */
export const TARGET_TO_WIN = 50;

/**
 * Claim pacing: a token bucket, not a flat gate.
 *
 * The rule's job is to cap how fast the *board* changes, but the board's
 * liveliness is roughly `players ÷ rate-limit`. r/place used a five-minute
 * cooldown and still felt frantic because it had millions of people. At the
 * handful of concurrent players this actually runs with, a 3s flat gate meant
 * ~0.67 claims/sec across the entire board — an app whose whole premise is
 * "everyone sees changes instantly", with nothing to see. It was suppressing the
 * exact thing it exists to demonstrate.
 *
 * A bucket fixes the shape as well as the number. A flat gate punishes your
 * first click as hard as your fiftieth; a bucket lets you burst — which is when
 * the game feels responsive — and only bites under sustained spam, which is when
 * you actually want it to.
 *
 * What it still has to prevent is narrow: one person racing to the target faster
 * than anyone can react. At 0.83 sustained claims/sec, reaching 50 tiles takes
 * the better part of a minute of uninterrupted clicking, in full view of everyone
 * who can steal them back. The protection survives; the deadness doesn't.
 *
 * Server-enforced. The pips in the UI are decoration — see
 * `backend/src/db/redis/scripts/bucket.lua.ts` for the rule that binds, and
 * `backend/test/bucket.test.ts` for the proof that it does.
 */
export const CLAIM_BUCKET_MAX = 4;
export const CLAIM_REFILL_MS = 1200;

/**
 * How long an idle player's bucket survives in Redis. Deliberately the time it
 * takes to refill from empty to full: any bucket older than that would have
 * refilled completely anyway, so letting it expire and re-materialise full is
 * identical behaviour with automatic garbage collection.
 */
export const BUCKET_TTL_MS = CLAIM_BUCKET_MAX * CLAIM_REFILL_MS * 2;

/** Patches and cursors are coalesced onto this tick rather than sent per-event. */
export const TICK_MS = 50;

export const CHALLENGE_TTL_MS = 10_000;
export const TRAY_SIZE = 9;

/** Cursor updates are throttled to this by the client before they reach the wire. */
export const CURSOR_THROTTLE_MS = 50;

/** 0 means unclaimed. Real players start at 1. */
export const UNCLAIMED = 0;

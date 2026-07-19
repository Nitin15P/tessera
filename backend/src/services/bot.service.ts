import { randomUUID } from "node:crypto";
import {
  CLAIM_REFILL_MS,
  GRID_H,
  GRID_W,
  TARGET_TO_WIN,
} from "@tessera/shared/protocol";
import type { PlayerIdx } from "@tessera/shared/domain";
import { env } from "../config/env";
import { redis } from "../db/redis";
import { K } from "../db/redis/keys";
import { onlinePlayers } from "../realtime/broadcaster";
import { markCursor, markCursorGone } from "../realtime/ticker";
import * as board from "./board.service";
import * as claims from "./claim.service";
import { declareWinner } from "./game.service";
import { ensureBot, type PlayerRecord } from "./player.service";

/**
 * The resident opponent.
 *
 * The whole reason this is short is that it invents nothing. It is a player with
 * no socket: instead of a browser sending `claim`/`solve`, this loop calls the
 * exact same `claim.service` functions on a timer. Its moves therefore spend from
 * the same token bucket, race the same atomic CAS, and fan out to every client
 * through the same pub/sub → mirror → ticker path a human's do. Nothing here is a
 * second implementation of the rules; it is only a decision about *which* tile to
 * play next.
 *
 * Three behaviours were asked for and are all local decisions read off the
 * in-memory board mirror (zero Redis reads to think, only to act):
 *
 *   scatter  — most claims land on a random empty cell anywhere, so the board
 *              fills unpredictably rather than as one creeping blob.
 *   grow     — sometimes it claims next to a tile it already owns, so it also
 *              builds real territory.
 *   steal    — it takes tiles back off other players, biased toward whoever is
 *              closest to winning, which knocks down runaway leaders and keeps a
 *              race alive instead of letting one player coast to 50.
 *
 * It plays *deliberately*, not flat out. The Lua bucket caps everyone's rate, but
 * the bot would otherwise sit exactly on that cap while spending zero thinking
 * time — no hunting for a tile, no second spent reading a steal puzzle — which is
 * why it felt unbeatable even "within the rules". So it paces itself well under
 * the ceiling on purpose: gaps longer than a refill, so charges pile up unused
 * and its real rate is roughly half what its bucket would allow. A person playing
 * casually out-claims it.
 */

// ---- personality knobs -----------------------------------------------------

/** Chance any given turn is a steal rather than a claim (when an opponent exists).
 *  Low, so it mostly builds its own and leaves your tiles alone. */
const STEAL_PROB = 0.16;
/** A human holding at least this fraction of the target flips the bot fully into
 *  steal-them-back mode — the defensive reflex against a runaway win. Set high, so
 *  it only really leans on you once you're closing on the finish. */
const STEAL_THREAT_FRACTION = 0.82;
/** When stealing, how often it targets the actual leader vs. a random rival. */
const LEADER_FOCUS = 0.6;
/** Of the claims, the share that scatter randomly vs. grow off existing tiles. */
const SCATTER_PROB = 0.55;
/** Chance it simply pauses a turn instead of acting. */
const HESITATE_PROB = 0.22;

// ---- pacing ----------------------------------------------------------------

/**
 * The gap between actions, jittered. Deliberately *longer than a refill*
 * (`CLAIM_REFILL_MS`, 1.2s): the bot waits out more than it needs, so its charges
 * sit full and go partly unspent, and its real claim rate lands around half of
 * what the bucket would permit. This — not the bucket — is what makes it beatable.
 */
const ACTION_MIN_MS = 1300;
const ACTION_MAX_MS = 2800;
/** A hesitation pause. */
const HESITATE_MIN_MS = 900;
const HESITATE_MAX_MS = 1800;
/** Polled cadence while nobody is here to play against. */
const STANDBY_MS = 900;
/** Extra wait once the bucket is spent, so the next attempt lands near a refill. */
const REFILL_SLACK_MS = 250;

/**
 * Match the room's energy.
 *
 * A human being *connected* isn't the same as a human *playing* — they switch
 * tabs, read something, step away for a minute. Running full-tilt through those
 * lulls is how the bot "wins it while you were gone". So it watches how recently a
 * human last touched the board and, once they've been quiet a moment, drops to a
 * slow crawl: still alive on the board, but nowhere near fast enough to run away
 * with a race unopposed. The instant someone claims again it snaps back to pace.
 */
const CALM_AFTER_MS = 2500;
/** The crawl it settles into while the humans present aren't actually claiming —
 *  slower still than its already-deliberate active pace. */
const IDLE_MIN_MS = 3500;
const IDLE_MAX_MS = 6500;

// ---- single-driver lock (belt-and-suspenders for a multi-instance deploy) --

/** Only the instance holding this lock drives the bot, so two instances can't
 *  double its speed. Single-instance today, so this is insurance, not need. */
const LOCK_TTL_MS = 6000;
const LOCK_RENEW_MS = 3000;

const jitter = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);
const pick = <T>(xs: T[]): T | null => (xs.length ? xs[Math.floor(Math.random() * xs.length)]! : null);

// ---- state -----------------------------------------------------------------

const instanceId = randomUUID();
let bot: PlayerRecord | null = null;
let holdsLock = false;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let lockTimer: ReturnType<typeof setInterval> | null = null;
/** When a human last changed the board. Fed by every non-bot board update, so it
 *  tracks actual play, not mere presence. */
let lastHumanAt = 0;
let stopWatching: (() => void) | null = null;

/** True once the humans in the room have gone quiet — no claim or steal from
 *  anyone but the bot for a beat. Drives the slow-down. */
function humansIdle(): boolean {
  return Date.now() - lastHumanAt > CALM_AFTER_MS;
}

/** True only when this instance is the driver, the bot exists, and a human is
 *  here to play against. Read by presence so the bot shows as online exactly when
 *  it is actually playing. */
export function isActive(): boolean {
  return holdsLock && bot !== null && onlinePlayers().length > 0;
}

/** The bot's index while it's active, else null — for the presence list. */
export function presenceIdx(): PlayerIdx | null {
  return isActive() ? bot!.idx : null;
}

// ---- board reading (all off the local mirror) ------------------------------

function neighbours(cell: number): number[] {
  const col = cell % GRID_W;
  const row = (cell - col) / GRID_W;
  const out: number[] = [];
  if (col > 0) out.push(cell - 1);
  if (col < GRID_W - 1) out.push(cell + 1);
  if (row > 0) out.push(cell - GRID_W);
  if (row < GRID_H - 1) out.push(cell + GRID_W);
  return out;
}

function countOwners(grid: Uint16Array): Map<number, number> {
  const cnt = new Map<number, number>();
  for (let i = 0; i < grid.length; i++) {
    const o = grid[i]!;
    if (o !== 0) cnt.set(o, (cnt.get(o) ?? 0) + 1);
  }
  return cnt;
}

/** The biggest non-bot holding right now, or null if the board is empty of rivals. */
function biggestRival(cnt: Map<number, number>, botIdx: number): { idx: number; score: number } | null {
  let idx = 0;
  let score = 0;
  for (const [owner, n] of cnt) {
    if (owner !== botIdx && n > score) {
      idx = owner;
      score = n;
    }
  }
  return idx === 0 ? null : { idx, score };
}

function randomCellOwnedBy(grid: Uint16Array, owner: number): number | null {
  const cells: number[] = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] === owner) cells.push(i);
  return pick(cells);
}

function randomEmptyCell(grid: Uint16Array): number | null {
  const empties: number[] = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] === 0) empties.push(i);
  return pick(empties);
}

/** An empty cell adjacent to one the bot already owns — the "grow" move. */
function growCell(grid: Uint16Array, botIdx: number): number | null {
  const frontier: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== botIdx) continue;
    for (const n of neighbours(i)) if (grid[n] === 0) frontier.push(n);
  }
  return pick(frontier);
}

function claimCell(grid: Uint16Array, botIdx: number): number | null {
  if (Math.random() >= SCATTER_PROB) {
    const g = growCell(grid, botIdx);
    if (g !== null) return g;
  }
  return randomEmptyCell(grid);
}

/** Point the bot's cursor at the tile it's about to play, so it visibly moves
 *  around the board like a hand rather than teleporting tiles into existence. */
function cursorTo(botIdx: number, cell: number): void {
  const col = cell % GRID_W;
  const row = (cell - col) / GRID_W;
  markCursor(botIdx, (col + 0.5) / GRID_W, (row + 0.5) / GRID_H);
}

// ---- one turn --------------------------------------------------------------

/** Decide a move and make it. Returns the outcome, or null if there was nothing
 *  to do (board full of nobody but the bot). */
async function takeTurn(me: PlayerRecord): Promise<claims.ClaimResult | null> {
  const grid = board.snapshot();
  const botIdx = me.idx;
  const cnt = countOwners(grid);
  const rival = biggestRival(cnt, botIdx);

  // A rival closing on the target overrides the dice: steal them back.
  const nearWin = rival !== null && rival.score >= TARGET_TO_WIN * STEAL_THREAT_FRACTION;
  const wantSteal = rival !== null && (nearWin || Math.random() < STEAL_PROB);

  if (wantSteal && rival !== null) {
    const others = [...cnt.keys()].filter((o) => o !== botIdx && o !== rival.idx);
    const targetIdx = Math.random() < LEADER_FOCUS ? rival.idx : (pick(others) ?? rival.idx);
    const cell = randomCellOwnedBy(grid, targetIdx);
    if (cell !== null) {
      cursorTo(botIdx, cell);
      return claims.autoSolve(me, cell);
    }
  }

  const cell = claimCell(grid, botIdx);
  if (cell !== null) {
    cursorTo(botIdx, cell);
    return claims.settle(me, cell);
  }

  // No empty land left — fall back to stealing if we didn't already try.
  if (rival !== null) {
    const cell = randomCellOwnedBy(grid, rival.idx);
    if (cell !== null) {
      cursorTo(botIdx, cell);
      return claims.autoSolve(me, cell);
    }
  }
  return null;
}

/** How long to wait before the next turn, given how the last one went. */
function nextDelay(res: claims.ClaimResult | null): number {
  // Out of charges: the only thing worth waiting a whole refill for.
  if (res && !res.ok && res.reason === "no_charges") return CLAIM_REFILL_MS + jitter(0, REFILL_SLACK_MS);
  // Spent the last charge on a good move: same wait, no point trying dry.
  if (res && res.ok && res.charges <= 0) return CLAIM_REFILL_MS + jitter(0, REFILL_SLACK_MS);
  // A lost race, a taken tile, or a normal success with charges to spare: go again.
  return jitter(ACTION_MIN_MS, ACTION_MAX_MS);
}

async function tick(): Promise<void> {
  loopTimer = null;
  if (!bot || !holdsLock) return schedule(STANDBY_MS);

  // Standby: no humans connected, so there is no game to be part of. The board is
  // left exactly as it is until someone shows up.
  if (onlinePlayers().length === 0) {
    markCursorGone(bot.idx);
    return schedule(STANDBY_MS);
  }

  // Occasionally take a beat instead of acting. Bounded by the same bucket as
  // everyone, the bot would otherwise sit exactly on the ceiling; a few skipped
  // turns leave it a touch beatable without making it passive.
  if (Math.random() < HESITATE_PROB) {
    return schedule(jitter(HESITATE_MIN_MS, HESITATE_MAX_MS));
  }

  let res: claims.ClaimResult | null = null;
  try {
    res = await takeTurn(bot);
  } catch (err) {
    console.error("[bot] turn failed:", err);
  }

  // A winning claim ends the race, exactly as a human's does — one claim in the
  // whole cluster carries `won`, so this declares at most once.
  if (res && res.ok && res.won) {
    void declareWinner(bot.idx, TARGET_TO_WIN).catch((err) =>
      console.error("[bot] declareWinner failed:", err),
    );
  }

  // When the room has gone quiet, stretch the wait right out so the bot pokes
  // along instead of sprinting. `max` so it never undercuts a refill wait.
  let delay = nextDelay(res);
  if (humansIdle()) delay = Math.max(delay, jitter(IDLE_MIN_MS, IDLE_MAX_MS));
  schedule(delay);
}

function schedule(ms: number): void {
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = setTimeout(() => void tick(), ms);
}

// ---- driver lock -----------------------------------------------------------

async function acquireOrRenew(): Promise<void> {
  try {
    const got = await redis.set(K.botLock, instanceId, "PX", LOCK_TTL_MS, "NX");
    if (got === "OK") {
      holdsLock = true;
      return;
    }
    // Someone holds it — if it's us, renew; otherwise stand down.
    const owner = await redis.get(K.botLock);
    if (owner === instanceId) {
      await redis.set(K.botLock, instanceId, "PX", LOCK_TTL_MS);
      holdsLock = true;
    } else {
      holdsLock = false;
    }
  } catch (err) {
    // A Redis hiccup shouldn't crash the loop; just don't act until it clears.
    holdsLock = false;
    console.error("[bot] lock error:", err);
  }
}

// ---- lifecycle -------------------------------------------------------------

export async function start(): Promise<void> {
  if (!env.botEnabled) {
    console.log("[bot] disabled (BOT_ENABLED=false)");
    return;
  }

  bot = await ensureBot();
  console.log(`[bot] ${bot.name} (idx ${bot.idx}) ready`);

  // Learn how active the humans are straight off the board stream: any change
  // whose new owner isn't the bot is a human claiming or stealing. That timestamp
  // is all the slow-down needs.
  lastHumanAt = Date.now();
  stopWatching = board.onUpdate((u) => {
    if (bot && u.owner !== bot.idx) lastHumanAt = Date.now();
  });

  await acquireOrRenew();
  lockTimer = setInterval(() => void acquireOrRenew(), LOCK_RENEW_MS);

  schedule(jitter(ACTION_MIN_MS, ACTION_MAX_MS));
}

export async function stop(): Promise<void> {
  if (loopTimer) clearTimeout(loopTimer);
  if (lockTimer) clearInterval(lockTimer);
  loopTimer = null;
  lockTimer = null;
  stopWatching?.();
  stopWatching = null;

  // Release the lock if we hold it, so another instance can pick the bot up
  // immediately rather than waiting out the TTL.
  if (holdsLock) {
    try {
      const owner = await redis.get(K.botLock);
      if (owner === instanceId) await redis.del(K.botLock);
    } catch {
      // Best effort; the TTL cleans it up regardless.
    }
  }
  holdsLock = false;
}

import { CHALLENGE_TTL_MS } from "@tessera/shared/protocol";
import type { RejectReason, TrayShape } from "@tessera/shared/domain";
import { boardRepo } from "../db/redis";
import type { BucketState } from "../db/redis/repositories/board.repository";
import { generateChallenge } from "../domain/challenge";
import { recordClaim } from "./eventLog.service";
import type { PlayerRecord } from "./player.service";

/**
 * Claiming, as one story.
 *
 * Nothing here knows what a socket is. That matters beyond tidiness: the claim
 * rule can be exercised without opening a connection, and a second transport
 * couldn't accidentally implement different rules.
 *
 * Note how thin this is. That's the point — the actual atomicity lives in Lua,
 * inside Redis, and this layer would be lying if it pretended to add safety on
 * top. It orchestrates; it does not adjudicate.
 */

export type { BucketState };

export type ClaimResult =
  | ({ ok: true; seq: number; prevOwner: number; won: boolean } & BucketState)
  | ({ ok: false; reason: RejectReason } & BucketState);

/** Settle unclaimed land. One round trip, no challenge. */
export async function settle(player: PlayerRecord, cell: number): Promise<ClaimResult> {
  const res = await boardRepo.claim({
    cell,
    playerIdx: player.idx,
    playerId: player.id,
    mode: "claim",
  });

  if (res.ok) {
    recordClaim({
      seq: res.seq,
      cell,
      playerId: player.id,
      playerIdx: player.idx,
      prevOwner: res.prevOwner,
      stolen: false,
    });
  }
  return res;
}

export type ChallengeResult =
  | ({ ok: true; tray: TrayShape[]; expiresMs: number } & BucketState)
  | ({ ok: false; reason: RejectReason } & BucketState);

/**
 * Open a challenge against an owned tile.
 *
 * The tray goes to the client; the answer stays in Redis with a TTL and is only
 * ever compared inside the Lua script. It never touches the wire.
 *
 * Opening costs no charge — solving does. Otherwise abandoning a tray would cost
 * you for a tile you never took.
 */
export async function openChallenge(
  player: PlayerRecord,
  cell: number,
): Promise<ChallengeResult> {
  const { tray, answer } = generateChallenge();

  const res = await boardRepo.openChallenge({
    cell,
    playerIdx: player.idx,
    playerId: player.id,
    answer: String(answer),
  });

  return res.ok
    ? {
        ok: true,
        tray,
        expiresMs: CHALLENGE_TTL_MS,
        charges: res.charges,
        nextChargeMs: res.nextChargeMs,
      }
    : { ok: false, reason: res.reason, charges: res.charges, nextChargeMs: res.nextChargeMs };
}

/**
 * Complete a steal.
 *
 * `answerIdx` is whatever the client clicked — untrusted, and simply handed to
 * the script to compare. The challenge is consumed there whether or not it was
 * right, so a correct answer can't be replayed.
 */
export async function solve(
  player: PlayerRecord,
  cell: number,
  answerIdx: number,
): Promise<ClaimResult> {
  const res = await boardRepo.claim({
    cell,
    playerIdx: player.idx,
    playerId: player.id,
    mode: "solve",
    answer: String(answerIdx),
  });

  if (res.ok) {
    recordClaim({
      seq: res.seq,
      cell,
      playerId: player.id,
      playerIdx: player.idx,
      prevOwner: res.prevOwner,
      stolen: true,
    });
  }
  return res;
}

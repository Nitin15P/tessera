import {
  BUCKET_TTL_MS,
  CHALLENGE_TTL_MS,
  CLAIM_BUCKET_MAX,
  CLAIM_REFILL_MS,
} from "@tessera/shared/protocol";
import type { RejectReason } from "@tessera/shared/domain";
import { scripts } from "../client";
import { K, UPDATES_CHANNEL } from "../keys";

/**
 * The board's persistence boundary.
 *
 * Everything above this line thinks in tiles and players. Everything below is
 * Redis. Services never see a key name or a Lua argument order, which is what
 * makes it possible to reason about the claim rule without also holding the
 * storage layout in your head.
 */

export type ClaimMode = "claim" | "solve";

/** The player's pacing state, returned on every outcome so the UI can be honest
 *  about it whether they won or lost. */
export interface BucketState {
  charges: number;
  nextChargeMs: number;
}

export type ClaimOutcome =
  | ({ ok: true; seq: number; prevOwner: number } & BucketState)
  | ({ ok: false; reason: RejectReason } & BucketState);

export interface ClaimArgs {
  cell: number;
  playerIdx: number;
  playerId: string;
  mode: ClaimMode;
  /** Tray index, as a string. Only read when mode is 'solve'. */
  answer?: string;
}

/**
 * Settle free land, or complete a steal. Both routes land in the same atomic
 * script because both end in the same write and must spend from the same bucket.
 */
export async function claim(args: ClaimArgs): Promise<ClaimOutcome> {
  const [status, a, b, charges, nextMs] = await scripts.claimCell(
    K.grid,
    K.seq,
    K.bucket(args.playerId),
    K.challenge(args.playerId),
    K.leaderboard,
    String(args.cell),
    String(args.playerIdx),
    args.mode,
    args.answer ?? "",
    UPDATES_CHANNEL,
    String(CLAIM_BUCKET_MAX),
    String(CLAIM_REFILL_MS),
    String(BUCKET_TTL_MS),
  );

  // Both paths return the same five slots, so the bucket is read from the same
  // place either way — see the note on arity in claim.lua.
  return status === "ok"
    ? {
        ok: true,
        seq: Number(a),
        prevOwner: Number(b),
        charges: Number(charges),
        nextChargeMs: Number(nextMs),
      }
    : {
        ok: false,
        reason: a as RejectReason,
        charges: Number(charges),
        nextChargeMs: Number(nextMs),
      };
}

export interface OpenChallengeArgs {
  cell: number;
  playerIdx: number;
  playerId: string;
  answer: string;
}

export type OpenChallengeOutcome =
  | ({ ok: true; currentOwner: number } & BucketState)
  | ({ ok: false; reason: RejectReason } & BucketState);

export async function openChallenge(
  args: OpenChallengeArgs,
): Promise<OpenChallengeOutcome> {
  const [status, a, charges, nextMs] = await scripts.openChallenge(
    K.grid,
    K.bucket(args.playerId),
    K.challenge(args.playerId),
    String(args.cell),
    String(args.playerIdx),
    args.answer,
    String(CHALLENGE_TTL_MS),
    String(CLAIM_BUCKET_MAX),
    String(CLAIM_REFILL_MS),
  );

  return status === "ok"
    ? {
        ok: true,
        currentOwner: Number(a),
        charges: Number(charges),
        nextChargeMs: Number(nextMs),
      }
    : {
        ok: false,
        reason: a as RejectReason,
        charges: Number(charges),
        nextChargeMs: Number(nextMs),
      };
}

export interface RawSnapshot {
  seq: number;
  /** Flat [field, value, field, value, ...] as Redis returns HGETALL. */
  flat: string[];
}

/** Grid and seq as one atomic pair — see readSnapshot.lua. */
export async function readSnapshot(): Promise<RawSnapshot> {
  const [seq, flat] = await scripts.readSnapshot(K.grid, K.seq);
  return { seq: Number(seq), flat };
}

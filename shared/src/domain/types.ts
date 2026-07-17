/**
 * The vocabulary of the game, independent of how it travels.
 *
 * Kept apart from `protocol/messages` on purpose: these are the nouns, those are
 * the envelopes. A message type changing shouldn't force a rethink of what a
 * player *is*.
 */

/**
 * A player's dense wire identity.
 *
 * Tiles store this, never a colour or a name. The board is therefore 2 bytes per
 * tile instead of a repeated hex string, and — more importantly — a player's
 * colour exists in exactly one place, so a tile cannot disagree with its owner.
 *
 * 0 is reserved for "unclaimed" and is never assigned.
 */
export type PlayerIdx = number;

/** Everything one player is allowed to know about another. */
export interface PublicPlayer {
  idx: PlayerIdx;
  name: string;
  color: string;
}

export type ShapeType = "triangle" | "square" | "circle" | "hex";

/** One cell of a steal challenge's tray. The answer is never part of this. */
export interface TrayShape {
  type: ShapeType;
  /** 0-360 */
  hue: number;
  /** degrees */
  rot: number;
}

export interface LeaderboardEntry {
  idx: PlayerIdx;
  score: number;
}

/** Why the server said no. Every one of these is a rule the client cannot enforce. */
export type RejectReason =
  /** Bucket empty. Named for the cause, not a mechanism that no longer exists. */
  | "no_charges"
  | "taken"
  | "bad_cell"
  | "own_cell"
  | "no_challenge"
  | "expired"
  | "wrong";

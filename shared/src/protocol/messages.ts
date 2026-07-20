import type {
  LeaderboardEntry,
  PlayerIdx,
  PublicPlayer,
  RejectReason,
  TrayShape,
} from "../domain/types";

/**
 * The wire protocol. This file is the contract between the two halves of the app
 * and is imported verbatim by both, so it cannot drift.
 *
 * Two ideas carry most of the weight:
 *
 *   `req` — a client-generated id echoed back on the response. It correlates an
 *   answer to the click that caused it, which is what lets the client clear
 *   exactly the right optimistic tile instead of guessing.
 *
 *   `seq` — a global counter bumped on every state change. Snapshots are stamped
 *   with the seq they were read at; patches carry their own. It is the ordering
 *   backbone, and the reason a reconnect can tell "I'm behind" from "I'm current".
 */

// ---------------------------------------------------------------- client -> server

export type ClaimMsg = { t: "claim"; cell: number; req: number };
export type ChallengeReqMsg = { t: "challenge"; cell: number; req: number };
export type SolveMsg = {
  t: "solve";
  req: number;
  /**
   * Sent for symmetry with the request, not trusted. The server checks it
   * against the challenge it stored, so lying here only gets you rejected.
   */
  cell: number;
  /** Tray position clicked. */
  idx: number;
};
export type CursorMsg = { t: "cursor"; x: number; y: number };
export type PingMsg = { t: "ping" };
/**
 * Set your own name and colour. Both are untrusted: the server sanitises the name
 * and pulls the colour into the board-readable band before storing either, so a
 * client can't hand itself an unreadable tile or a name that breaks the layout.
 */
export type SetProfileMsg = { t: "setProfile"; name: string; color: string };

export type ClientMsg =
  | ClaimMsg
  | ChallengeReqMsg
  | SolveMsg
  | CursorMsg
  | SetProfileMsg
  | PingMsg;

export type ClientMsgType = ClientMsg["t"];

// ---------------------------------------------------------------- server -> client

export type WelcomeMsg = {
  t: "welcome";
  you: PublicPlayer;
  w: number;
  h: number;
  /** The pacing rule, told rather than assumed. The client renders what the
   *  server says it enforces, so the two can never advertise different games. */
  bucketMax: number;
  refillMs: number;
  /** Tiles a single player must hold at once to win the board and reset it. Sent
   *  so the client renders "distance to win" against the goal the server enforces. */
  target: number;
  /**
   * Echoed so a first-time browser can persist it and return as the same player.
   * Identifies a browser, not a person — see backend/src/services/player.service.
   */
  token: string;
};

/** `grid` is base64 of a little-endian Uint16Array, one entry per cell. */
export type SnapshotMsg = {
  t: "snapshot";
  seq: number;
  grid: string;
  players: PublicPlayer[];
};

export type PatchMsg = {
  t: "patch";
  seq: number;
  cells: [cell: number, owner: PlayerIdx][];
  /**
   * Identities the recipient hasn't been sent yet. A patch can reference a
   * player who joined after this client's snapshot, so we ship the colour
   * just-in-time rather than making the client ask for it.
   */
  players?: PublicPlayer[];
};

export type ClaimResultMsg = {
  t: "claimResult";
  req: number;
  ok: boolean;
  cell: number;
  reason?: RejectReason;
  /**
   * The bucket as the server sees it, attached to every reply — accepted or
   * rejected. The client predicts refill locally so the pips animate smoothly,
   * but prediction drifts; this is the correction, and it arrives on every
   * single interaction rather than needing its own message.
   */
  charges?: number;
  /** ms until the next charge lands. 0 when already full. */
  nextChargeMs?: number;
};

export type ChallengeMsg = {
  t: "challenge";
  req: number;
  cell: number;
  tray: TrayShape[];
  expiresMs: number;
};

/**
 * A player reached the target and won the board. Broadcast to everyone the
 * instant it happens; the blank board arrives right behind it as a fresh
 * snapshot. The client shows a banner, then reveals the reset board under it.
 */
export type GameOverMsg = {
  t: "gameOver";
  winner: PublicPlayer;
  score: number;
};

/**
 * A player changed their name or colour. Broadcast to everyone so their tiles,
 * cursor, leaderboard row and presence entry all re-render at once.
 *
 * Deliberately its own message rather than riding the `players` field of a patch:
 * a patch is stamped with a board seq and a profile change carries none, so it
 * would be discarded by the client's "already covered by my snapshot" guard.
 */
export type PlayerUpdateMsg = { t: "playerUpdate"; player: PublicPlayer };

export type PresenceMsg = { t: "presence"; online: PlayerIdx[] };
export type CursorsMsg = { t: "cursors"; c: [PlayerIdx, number, number][] };
export type LeaderboardMsg = { t: "leaderboard"; top: LeaderboardEntry[] };
export type PongMsg = { t: "pong" };

export type ServerMsg =
  | WelcomeMsg
  | SnapshotMsg
  | PatchMsg
  | ClaimResultMsg
  | ChallengeMsg
  | GameOverMsg
  | PlayerUpdateMsg
  | PresenceMsg
  | CursorsMsg
  | LeaderboardMsg
  | PongMsg;

export type ServerMsgType = ServerMsg["t"];

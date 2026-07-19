import {
  CELL_COUNT,
  CLAIM_BUCKET_MAX,
  CLAIM_REFILL_MS,
  type PlayerIdx,
  type PublicPlayer,
  type RejectReason,
  type TrayShape,
} from "@tessera/shared";

/**
 * All client state, deliberately outside React.
 *
 * The board changes up to 20 times a second. Putting the grid in React state
 * would mean reconciling on every patch to repaint pixels React can't see
 * anyway — the canvas draws itself. So the grid lives in a plain Uint16Array
 * that the renderer reads directly each frame, and React is told nothing.
 *
 * React does need to know about the slow things — who's online, the leaderboard,
 * connection status, the open challenge — so those bump a version counter that
 * useSyncExternalStore watches. Two channels, matched to two very different
 * update rates.
 *
 * The other half of this file is the optimistic model:
 *
 *   confirmed  what the server last told us. The truth.
 *   pending    what we're hoping for. A guess with a timestamp.
 *
 * What renders is confirmed with pending painted over it. When the server
 * answers — win *or* lose — the pending entry is simply deleted. There is no
 * rollback path, because there is nothing to roll back: stop overriding and the
 * truth is already underneath, correct by construction. That is the entire
 * reason for splitting them rather than mutating one grid optimistically.
 */

export interface PendingClaim {
  playerIdx: PlayerIdx;
  req: number;
  at: number;
  /** True when this optimistic claim is a *steal* (solving a challenge), so the
   *  reply handler can play the capture sound only on a successful steal. */
  steal?: boolean;
}

export interface Cursor {
  /** Where they actually are. */
  tx: number;
  ty: number;
  /** Where we're drawing them — chases the target so 20Hz reads as smooth. */
  x: number;
  y: number;
  seen: number;
}

export interface OpenChallenge {
  cell: number;
  req: number;
  tray: TrayShape[];
  expiresAt: number;
  /** The full TTL, so the countdown bar scales to the real duration rather than
   *  a hardcoded number that silently breaks if the server's TTL changes. */
  durationMs: number;
}

export type Status = "connecting" | "live" | "reconnecting";

/** The moment a race is won, held just long enough to celebrate before the board
 *  reset lands underneath and the banner clears. */
export interface WinnerInfo {
  player: PublicPlayer;
  score: number;
  /** When the banner is due to clear, so the overlay can show a live countdown to
   *  the next race rather than a static message. */
  until: number;
}

export interface Toast {
  id: number;
  text: string;
  tone: "bad" | "good";
}

class Store {
  // ---- hot: read by the renderer every frame, never by React ----
  confirmed = new Uint16Array(CELL_COUNT);
  pending = new Map<number, PendingClaim>();
  cursors = new Map<PlayerIdx, Cursor>();
  hover: number | null = null;

  // ---- cool: React reads these via useSyncExternalStore ----
  me: PublicPlayer | null = null;
  players = new Map<PlayerIdx, PublicPlayer>();
  online: PlayerIdx[] = [];
  top: { idx: PlayerIdx; score: number }[] = [];
  challenge: OpenChallenge | null = null;
  status: Status = "connecting";
  /** Set when a race is won; drives the winner banner. Cleared on a timer. */
  winner: WinnerInfo | null = null;
  /** First-visit onboarding: the name/colour modal is open. Also reopened when the
   *  player clicks their own name chip to edit later. */
  onboarding = false;
  /** The post-onboarding guided highlight pointing at the "How it works" pill. */
  spotlight = false;
  /** The rules popover (opened from the top-bar pill) is showing. */
  rulesOpen = false;
  /** Tiles one player must hold to win, as told by the server in `welcome`. The
   *  leaderboard renders progress against this rather than against the leader. */
  target = 0;

  /**
   * The bucket, as last reported by the server, plus the local clock reading at
   * that moment.
   *
   * We predict refill between replies so the pips animate smoothly instead of
   * stepping on every round trip — but prediction is only ever cosmetic. Every
   * claimResult carries the server's real count and overwrites this. The client
   * is never the authority on how many charges you have; it is only trying to
   * draw the right number in between being told.
   */
  charges = CLAIM_BUCKET_MAX;
  chargesAt = 0;
  /** Told to us in `welcome`. The shared constants are only defaults — the
   *  server owns this rule, so we display what it says rather than assume. */
  bucketMax = CLAIM_BUCKET_MAX;
  refillMs = CLAIM_REFILL_MS;
  toasts: Toast[] = [];
  seq = 0;

  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  /** Only for changes React should see. Board patches must not call this. */
  bump() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  playerAt(idx: PlayerIdx): PublicPlayer | null {
    return idx === 0 ? null : (this.players.get(idx) ?? null);
  }

  /** What the board should show for a cell: our guess if we have one, else truth. */
  ownerAt(cell: number): PlayerIdx {
    return this.pending.get(cell)?.playerIdx ?? this.confirmed[cell]!;
  }

  /**
   * Charges right now, predicted forward from the last server report using the
   * same whole-periods arithmetic the Lua uses. Matching that exactly is what
   * keeps the pips from disagreeing with reality.
   */
  chargesNow(now = Date.now()): number {
    if (this.chargesAt === 0) return this.charges;
    const gained = Math.floor((now - this.chargesAt) / this.refillMs);
    return Math.min(this.bucketMax, this.charges + Math.max(0, gained));
  }

  canClaim(now = Date.now()): boolean {
    return this.chargesNow(now) >= 1;
  }

  /** 0..1 progress toward the next charge, for the partially-filled pip. Returns
   *  0 when full — nothing is refilling. */
  refillFraction(now = Date.now()): number {
    if (this.chargesNow(now) >= this.bucketMax || this.chargesAt === 0) return 0;
    const since = (now - this.chargesAt) % this.refillMs;
    return since / this.refillMs;
  }

  /**
   * Server's word, on every reply. Overwrites any prediction.
   *
   * `nextChargeMs` matters: the server is usually part-way through a refill
   * period, so anchoring `chargesAt` at `now` would make the client predict the
   * next charge a full period away when the server will grant it sooner. That
   * gap briefly refuses clicks the server would accept. Instead we back-date the
   * anchor so the first predicted increment lands exactly when the server's
   * does. When full (or nothing is refilling), a plain `now` anchor is fine.
   */
  setBucket(charges: number, nextChargeMs = 0, now = Date.now()): void {
    this.charges = charges;
    this.chargesAt =
      charges >= this.bucketMax || nextChargeMs <= 0
        ? now
        : now - (this.refillMs - nextChargeMs);
  }

  toast(text: string, tone: Toast["tone"] = "bad") {
    const t = { id: Date.now() + Math.random(), text, tone };
    this.toasts = [...this.toasts.slice(-2), t];
    this.bump();
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      this.bump();
    }, 2600);
  }

  /**
   * Pending entries are swept on a timer as well as on reply, because a reply
   * can be lost — the socket can die between our send and the server's answer.
   * Without this a dropped response would leave a cell showing our colour
   * forever, which is exactly the silent divergence the whole design is
   * supposed to prevent. It would be embarrassing to import the bug on the
   * client after taking such care to keep it out of the server.
   */
  sweepPending(now = Date.now()) {
    let changed = false;
    for (const [cell, p] of this.pending) {
      if (now - p.at > 2000) {
        this.pending.delete(cell);
        changed = true;
      }
    }
    return changed;
  }
}

export const store = new Store();

export const REJECTION_TEXT: Record<RejectReason, string> = {
  no_charges: "Out of charges, one back in a moment",
  taken: "Someone got there first",
  bad_cell: "Can't claim that",
  own_cell: "Already yours",
  no_challenge: "Challenge expired",
  expired: "Challenge expired",
  wrong: "Wrong one, try again",
};

import { CELL_COUNT } from "@tessera/shared/protocol";
import { inBounds } from "@tessera/shared/domain";
import { subscriber, UPDATES_CHANNEL, boardRepo } from "../db/redis";

/**
 * The local read mirror.
 *
 * Each backend instance keeps a full copy of the board. Redis stays the
 * authority — every *write* goes through the Lua script — but reads are served
 * from memory, so a new connection's snapshot costs zero Redis round trips no
 * matter how many people join at once. The mirror is only ever advanced by the
 * pub/sub stream that every instance sees, so instances cannot drift apart.
 *
 * Hydration uses subscribe-then-snapshot, the same pattern the browser uses
 * against this server. The identical bug and fix appear at both layers:
 *
 *   snapshot-then-subscribe -> a write landing in the gap is lost forever
 *   subscribe-then-snapshot -> a write landing in the gap arrives twice
 *
 * Applying an update twice is idempotent; losing one is permanent. Take the
 * duplicate every time.
 */

export interface BoardUpdate {
  seq: number;
  cell: number;
  owner: number;
  prev: number;
}

type Listener = (u: BoardUpdate) => void;

const grid = new Uint16Array(CELL_COUNT);
const listeners = new Set<Listener>();

let localSeq = 0;
let ready = false;
let hydrating: Promise<void> | null = null;
let pending: BoardUpdate[] = [];

export const onUpdate = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const snapshot = (): Uint16Array => grid;
export const currentSeq = (): number => localSeq;
export const isReady = (): boolean => ready;
export const ownerOf = (cell: number): number => (inBounds(cell) ? grid[cell]! : 0);

function apply(u: BoardUpdate): void {
  grid[u.cell] = u.owner;
  localSeq = u.seq;
  for (const fn of listeners) fn(u);
}

function ingest(u: BoardUpdate): void {
  if (!ready) {
    pending.push(u);
    return;
  }

  // The global sequence only ever moves forward — every instance shares one
  // INCR, so it's monotonic across the whole cluster. If it comes back *lower*
  // than where we are, the counter was reset under us: Redis was flushed or
  // restarted. The mirror is now stale and must be re-read from scratch. Without
  // this, a reset makes every subsequent update look like an old duplicate and
  // the instance silently goes deaf. (Equal seq is a genuine duplicate — drop.)
  if (u.seq < localSeq) {
    console.warn(`[board] seq regressed ${localSeq} -> ${u.seq} (Redis reset) — re-hydrating`);
    void hydrate("reset");
    return;
  }
  if (u.seq === localSeq) return; // duplicate; dropping is safe

  // A forward gap means a publish was missed. Redis pub/sub is fire-and-forget —
  // no redelivery — so this is real, not theoretical. We can't patch a hole we
  // can't see into, so re-read everything.
  if (u.seq > localSeq + 1) {
    console.warn(`[board] seq gap: at ${localSeq}, got ${u.seq} — re-hydrating`);
    void hydrate("gap");
    return;
  }

  apply(u); // seq === localSeq + 1, the steady-state case
}

function parse(raw: string): BoardUpdate | null {
  const parts = raw.split(":").map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [seq, cell, owner, prev] = parts as [number, number, number, number];
  return { seq, cell, owner, prev };
}

/**
 * Called after a *reset* re-hydrate re-syncs the mirror, so the app can push a
 * fresh snapshot to every connected client. Registered by app.ts to avoid a
 * circular import between this service and the broadcaster.
 */
let resyncClients: (() => void) | null = null;
export const setResyncHandler = (fn: () => void): void => {
  resyncClients = fn;
};

export type HydrateReason = "initial" | "gap" | "reset";

/** Subscribe first, then read. Never the reverse. */
export async function hydrate(reason: HydrateReason = "initial"): Promise<void> {
  // Concurrent callers (a gap found mid-hydrate) share the one in flight.
  if (hydrating) return hydrating;

  // Were we already serving clients before this? If so and this is a reset, the
  // clients are now stale relative to the reset store and must be re-synced.
  const wasReady = ready;

  hydrating = (async () => {
    ready = false;
    pending = [];

    if (!subscriber.listenerCount("message")) {
      subscriber.on("message", (channel: string, raw: string) => {
        if (channel !== UPDATES_CHANNEL) return;
        const u = parse(raw);
        if (u) ingest(u);
      });
    }
    await subscriber.subscribe(UPDATES_CHANNEL);

    const { seq, flat } = await boardRepo.readSnapshot();

    grid.fill(0);
    for (let i = 0; i < flat.length; i += 2) {
      const cell = Number(flat[i]);
      if (inBounds(cell)) grid[cell] = Number(flat[i + 1]);
    }
    localSeq = seq;
    ready = true;

    // Anything that arrived while we were reading. Entries at or below the
    // snapshot's seq are already in it — that's the duplicate we deliberately
    // accepted, and this is where it's discarded.
    const queued = pending.sort((a, b) => a.seq - b.seq);
    pending = [];
    let replayed = 0;
    for (const u of queued) {
      if (u.seq <= localSeq) continue;
      apply(u);
      replayed++;
    }

    console.log(
      `[board] hydrated at seq ${seq} (${flat.length / 2} claimed` +
        `${replayed ? `, ${replayed} replayed from the gap` : ""})`,
    );

    // A reset (Redis flushed/restarted) leaves connected clients showing
    // pre-reset state — our own mirror just corrected, but theirs didn't. Push a
    // fresh snapshot to each so everyone converges on the reset truth. A gap
    // re-hydrate needs none of this: clients got the publishes we merely missed.
    if (reason === "reset" && wasReady) {
      console.warn("[board] reset — re-syncing all connected clients");
      resyncClients?.();
    }
  })();

  try {
    await hydrating;
  } finally {
    hydrating = null;
  }
}

// A dropped subscriber connection means we were deaf for some interval, so the
// mirror is suspect the moment it returns — and Redis may have restarted while
// we were disconnected, so treat it as a reset and re-sync clients too.
subscriber.on("ready", () => {
  if (ready) {
    console.warn("[board] subscriber reconnected — re-hydrating");
    void hydrate("reset");
  }
});

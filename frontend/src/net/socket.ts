import {
  decodeGrid,
  type ClientMsg,
  type PlayerIdx,
  type ServerMsg,
} from "@tessera/shared";
import { REJECTION_TEXT, store } from "../state/store";
import { playCapture } from "../sound";

/**
 * The socket.
 *
 * Worth being precise about why this looks different from the server's
 * mirror-hydration, which solves an apparently identical problem:
 *
 *   Redis pub/sub is fire-and-forget. It has no redelivery, so the server *can*
 *   silently miss a message and must watch for sequence gaps to notice.
 *
 *   A WebSocket is ordered and reliable for as long as it is open. We cannot
 *   miss a patch mid-connection — if delivery fails, the connection fails, and
 *   we reconnect and get a fresh snapshot. So there is no gap to detect here,
 *   and pretending otherwise would be cargo-culting the server's solution to a
 *   problem this layer doesn't have.
 *
 * What we *do* need is the snapshot boundary. A patch can be flushed between the
 * server registering this socket and the snapshot being read (registration comes
 * first, on purpose — losing an update is forever, receiving one twice is free).
 * So patches arriving before the snapshot are buffered, not applied to a grid
 * that doesn't exist yet, and anything already covered by the snapshot is
 * discarded once it lands.
 */

const TOKEN_KEY = "tessera:token";
const CURSOR_HZ_MS = 50;
/** How long the winner banner stays up before revealing the fresh race under it.
 *  The backend mirrors this (BANNER_MS in backend/src/services/bot.service.ts) to
 *  keep the bot out of the fresh board for the same window. */
const WINNER_BANNER_MS = 5000;

let ws: WebSocket | null = null;
let snapshotSeq = -1;
let buffered: Extract<ServerMsg, { t: "patch" }>[] = [];
let reqCounter = 1;
let backoff = 400;
let cursorTimer = 0;
let winnerTimer = 0;
let closedForGood = false;

const url = () => {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const token = localStorage.getItem(TOKEN_KEY);
  return `${proto}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`;
};

export function connect() {
  if (closedForGood) return;
  ws = new WebSocket(url());
  snapshotSeq = -1;
  buffered = [];

  ws.onopen = () => {
    backoff = 400;
  };

  ws.onmessage = (ev) => {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(ev.data as string) as ServerMsg;
    } catch {
      return;
    }
    handle(msg);
  };

  ws.onclose = () => {
    if (closedForGood) return;
    store.status = "reconnecting";
    store.cursors.clear();
    store.bump();
    setTimeout(connect, backoff);
    // Backing off protects the server from a thundering herd if it restarts
    // while fifty people have the page open.
    backoff = Math.min(backoff * 1.8, 8000);
  };

  ws.onerror = () => ws?.close();
}

function send(msg: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function handle(msg: ServerMsg) {
  switch (msg.t) {
    case "welcome": {
      localStorage.setItem(TOKEN_KEY, msg.token);
      store.me = msg.you;
      store.bucketMax = msg.bucketMax;
      store.refillMs = msg.refillMs;
      store.target = msg.target;
      store.setBucket(msg.bucketMax);
      store.players.set(msg.you.idx, msg.you);
      store.bump();
      return;
    }

    case "snapshot": {
      store.confirmed = decodeGrid(msg.grid);
      store.seq = msg.seq;
      snapshotSeq = msg.seq;
      for (const p of msg.players) store.players.set(p.idx, p);

      // Anything that arrived while the snapshot was in flight. Entries at or
      // below its seq are already baked into it.
      for (const p of buffered.sort((a, b) => a.seq - b.seq)) {
        if (p.seq > snapshotSeq) applyPatch(p);
      }
      buffered = [];

      // A reconnect can land us on a board that moved on without us; any guess
      // we were holding is meaningless now.
      store.pending.clear();
      store.status = "live";
      store.bump();
      return;
    }

    case "patch": {
      if (snapshotSeq < 0) {
        buffered.push(msg);
        return;
      }
      // A patch at or below the latest snapshot's seq is already baked into that
      // snapshot. In steady state this never happens — patches only ever move the
      // seq forward. It happens at a re-sync boundary: after a race reset the
      // server injects a fresh (higher-seq) snapshot out of band, and a straggler
      // patch from the finished race can still be in flight behind it. Dropping it
      // is what stops the winning tile from reappearing on the blank board.
      if (msg.seq <= snapshotSeq) return;
      applyPatch(msg);
      return;
    }

    case "claimResult": {
      // Win or lose, the guess is over. Deleting it *is* the rollback: whatever
      // the server said is already sitting in `confirmed` underneath.
      const p = store.pending.get(msg.cell);
      const wasMySteal = !!p && p.req === msg.req && p.steal === true;
      if (p && p.req === msg.req) store.pending.delete(msg.cell);

      // The server reports the bucket on every reply, accepted or rejected, so
      // our prediction is corrected on every single interaction rather than
      // being allowed to drift until something else happens to sync it.
      if (typeof msg.charges === "number") {
        store.setBucket(msg.charges, msg.nextChargeMs ?? 0);
        store.bump();
      }

      if (!msg.ok && msg.reason) {
        // Self-heal: `bad_cell` on a steal means the server sees that tile as
        // empty while our board thought it was owned — a divergence (normally
        // only possible if the grid was mutated out-of-band, e.g. a test HDEL,
        // since tiles never revert to empty in play). Believe the server and
        // correct our local view instead of showing the ghost until a refresh.
        if (msg.reason === "bad_cell") {
          store.confirmed[msg.cell] = 0;
        } else {
          // Every other rejection is normal play — losing a race, out of
          // charges, wrong shape. Surface it; the board itself already reflects
          // the truth underneath.
          store.toast(REJECTION_TEXT[msg.reason]);
        }
      } else if (msg.ok && wasMySteal) {
        // A successful capture of someone else's tile — and only that. A normal
        // claim of empty land is silent, and a failed challenge (wrong shape)
        // never reaches here as ok, so it stays silent too.
        playCapture();
      }
      return;
    }

    case "challenge": {
      store.challenge = {
        cell: msg.cell,
        req: msg.req,
        tray: msg.tray,
        expiresAt: Date.now() + msg.expiresMs,
        durationMs: msg.expiresMs,
      };
      store.bump();
      return;
    }

    case "cursors": {
      const now = Date.now();
      for (const [idx, x, y] of msg.c) {
        // Off-board coordinates mean "gone" — see hub.ts.
        if (x < 0 || y < 0) {
          store.cursors.delete(idx);
          continue;
        }
        const existing = store.cursors.get(idx);
        if (existing) {
          existing.tx = x;
          existing.ty = y;
          existing.seen = now;
        } else {
          // First sighting starts where it is, or it slides in from the corner.
          store.cursors.set(idx, { x, y, tx: x, ty: y, seen: now });
        }
      }
      return;
    }

    case "gameOver": {
      // Someone hit the target. Show the banner; the blank board arrives right
      // behind this as a fresh snapshot and settles underneath it. The banner is
      // cleared on a local timer rather than by the next message, so the win gets
      // its moment before the new race is revealed already live.
      store.winner = { player: msg.winner, score: msg.score, until: Date.now() + WINNER_BANNER_MS };
      store.players.set(msg.winner.idx, msg.winner);
      // Pin the winner into the standings at their winning score, so the frozen
      // leaderboard beside the banner definitely shows who won even if the last
      // pre-reset tick hadn't caught the final claim. The `leaderboard` case then
      // holds this frozen for as long as the banner is up.
      const existing = store.top.find((t) => t.idx === msg.winner.idx);
      if (existing) existing.score = msg.score;
      else store.top = [{ idx: msg.winner.idx, score: msg.score }, ...store.top];
      store.bump();
      clearTimeout(winnerTimer);
      winnerTimer = window.setTimeout(() => {
        store.winner = null;
        store.bump();
      }, WINNER_BANNER_MS);
      return;
    }

    case "presence": {
      store.online = msg.online;
      store.bump();
      return;
    }

    case "leaderboard": {
      // While the winner banner is up, hold the final standings frozen. The board
      // resets on the server the instant a race ends, so the very next leaderboard
      // would arrive already emptied — but the player should keep seeing who won
      // and the closing scores beside the banner until the next race actually
      // begins. When the banner clears, the following tick shows the fresh race.
      if (store.winner) return;
      store.top = msg.top;
      store.bump();
      return;
    }
  }
}

function applyPatch(msg: Extract<ServerMsg, { t: "patch" }>) {
  if (msg.players) {
    for (const p of msg.players) store.players.set(p.idx, p);
    store.bump();
  }
  for (const [cell, owner] of msg.cells) {
    store.confirmed[cell] = owner;
    // The server has spoken about this cell; our guess about it is obsolete
    // whether or not it was our claim that landed.
    const p = store.pending.get(cell);
    if (p && p.playerIdx === owner) store.pending.delete(cell);
  }
  store.seq = msg.seq;
}

// ---------------------------------------------------------------- actions

/** Settle free land — optimistic, resolves in one round trip. */
export function claim(cell: number) {
  if (!store.me) return;
  // A local guard to avoid a pointless round trip, not the rule. The server
  // re-checks and is the only thing that actually decides.
  if (!store.canClaim()) return store.toast("Out of charges");
  if (store.pending.has(cell)) return;

  const req = reqCounter++;
  // Paint the guess now; the server decides in ~30ms.
  store.pending.set(cell, { playerIdx: store.me.idx, req, at: Date.now() });
  send({ t: "claim", cell, req });
}

/** Ask for the challenge that gates stealing owned land. */
export function requestChallenge(cell: number) {
  if (!store.me) return;
  if (!store.canClaim()) return store.toast("Out of charges");
  send({ t: "challenge", cell, req: reqCounter++ });
}

export function solve(idx: number) {
  const ch = store.challenge;
  if (!ch || !store.me) return;

  const req = reqCounter++;
  // steal:true — so a successful reply plays the capture sound.
  store.pending.set(ch.cell, { playerIdx: store.me.idx, req, at: Date.now(), steal: true });
  send({ t: "solve", req, cell: ch.cell, idx });

  store.challenge = null;
  store.bump();
}

export function cancelChallenge() {
  store.challenge = null;
  store.bump();
}

export function sendCursor(x: number, y: number) {
  const now = Date.now();
  if (now - cursorTimer < CURSOR_HZ_MS) return;
  cursorTimer = now;
  send({ t: "cursor", x, y });
}

export function disconnect() {
  closedForGood = true;
  ws?.close();
}

export type { PlayerIdx };

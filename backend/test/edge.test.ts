import WebSocket from "ws";
import Redis from "ioredis";
import { CELL_COUNT, TRAY_SIZE } from "@tessera/shared/protocol";
import type { ServerMsg } from "@tessera/shared/protocol";
import { WS_URL, REDIS_URL, dim, report, solveTray, wait } from "./harness";

/**
 * The nasty inputs and the boundaries.
 *
 * A real-time server takes bytes from anyone, so the questions are: does garbage
 * crash it, does it answer things it shouldn't, and do the rules hold exactly at
 * their edges (the first tile, the last tile, an empty bucket, a consumed
 * challenge). Every check drives the server the way a hostile or buggy client
 * would, and the recurring assertion after each bad thing is "the connection is
 * still alive and a normal claim still works" — because a server that dies, or
 * silently wedges a connection, on one bad message is the actual failure.
 *
 * Run: npm run test:edge
 */

interface Raw {
  ws: WebSocket;
  idx: number;
  token: string;
  msgs: ServerMsg[];
  send: (v: unknown) => void;
  raw: (s: string) => void;
  close: () => void;
}

function open(tokenIn?: string): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const url = tokenIn ? `${WS_URL}?token=${encodeURIComponent(tokenIn)}` : WS_URL;
    const ws = new WebSocket(url);
    const c: Raw = {
      ws,
      idx: 0,
      token: "",
      msgs: [],
      send: (v) => ws.send(JSON.stringify(v)),
      raw: (s) => ws.send(s),
      close: () => ws.close(),
    };
    const t = setTimeout(() => reject(new Error("connect timeout")), 8000);
    ws.on("message", (buf) => {
      const m = JSON.parse(buf.toString()) as ServerMsg;
      c.msgs.push(m);
      if (m.t === "welcome") {
        c.idx = m.you.idx;
        c.token = m.token;
      }
      if (m.t === "snapshot") {
        clearTimeout(t);
        resolve(c);
      }
    });
    ws.on("error", reject);
  });
}

const results = (c: Raw) => c.msgs.filter((m) => m.t === "claimResult") as Extract<ServerMsg, { t: "claimResult" }>[];
const lastResult = (c: Raw) => results(c).at(-1);
const clearMsgs = (c: Raw) => (c.msgs.length = 0);

async function main() {
  const redis = new Redis(REDIS_URL);
  await redis.flushall();

  const checks: [string, boolean][] = [];
  const add = (label: string, pass: boolean) => checks.push([label, pass]);

  // ---------------------------------------------------------------- boundaries
  {
    const c = await open();
    c.send({ t: "claim", cell: 0, req: 1 });
    c.send({ t: "claim", cell: CELL_COUNT - 1, req: 2 });
    await wait(300);
    const ok = results(c).filter((r) => r.ok).length;
    add("first and last tile (0 and 1499) are claimable", ok === 2);
    c.close();
  }

  // ---------------------------------------------------------- out-of-range dropped
  {
    const c = await open();
    for (const [i, cell] of [-1, CELL_COUNT, 1e12, 4.5, 0.1].entries()) {
      c.send({ t: "claim", cell, req: 100 + i });
    }
    c.send({ t: "claim", cell: null, req: 200 });
    c.send({ t: "claim", cell: "5", req: 201 });
    await wait(300);
    add("out-of-range / mistyped cells get no reply (dropped at boundary)", results(c).length === 0);

    // …and the connection still works right after.
    clearMsgs(c);
    c.send({ t: "claim", cell: 50, req: 300 });
    await wait(250);
    add("connection still serves a valid claim after bad input", lastResult(c)?.ok === true);
    c.close();
  }

  // ----------------------------------------------------------- malformed frames
  {
    const c = await open();
    c.raw("this is not json");
    c.raw("42");
    c.raw("[1,2,3]");
    c.raw("null");
    c.raw("{");
    c.send({}); // no type
    c.send({ t: "nope" }); // unknown type
    c.send({ t: "claim" }); // missing fields
    await wait(300);
    add("malformed frames are silently dropped", results(c).length === 0);

    // Connection must survive all of that.
    clearMsgs(c);
    c.send({ t: "claim", cell: 60, req: 1 });
    await wait(250);
    add("connection survives a burst of malformed frames", lastResult(c)?.ok === true);
    c.close();
  }

  // -------------------------------------------------------------- large payload
  {
    const c = await open();
    const junk = "x".repeat(200_000);
    c.send({ t: "claim", cell: 70, req: 1, junk });
    await wait(400);
    add("a 200KB payload is handled and the claim inside it lands", lastResult(c)?.ok === true);
    c.close();
  }

  // --------------------------------------------------------------- challenge edges
  {
    const owner = await open();
    const thief = await open();
    const tile = 500;
    await redis.hdel("grid", String(tile));

    owner.send({ t: "claim", cell: tile, req: 1 });
    await wait(250);

    // Solve with nothing open.
    thief.send({ t: "solve", req: 2, cell: tile, idx: 0 });
    await wait(200);
    add("solving with no open challenge is rejected", lastResult(thief)?.reason === "no_challenge");

    // Challenge free land.
    clearMsgs(thief);
    thief.send({ t: "challenge", cell: 900, req: 3 });
    await wait(200);
    add("challenging an unclaimed tile is rejected (bad_cell)", lastResult(thief)?.reason === "bad_cell");

    // Challenge your own tile.
    clearMsgs(thief);
    thief.send({ t: "claim", cell: 901, req: 4 });
    await wait(200);
    thief.send({ t: "challenge", cell: 901, req: 5 });
    await wait(200);
    add("challenging your own tile is rejected (own_cell)", lastResult(thief)?.reason === "own_cell");

    // Open a real challenge on the owner's tile.
    clearMsgs(thief);
    thief.send({ t: "challenge", cell: tile, req: 6 });
    await wait(250);
    const chMsg = thief.msgs.find((m) => m.t === "challenge") as
      | Extract<ServerMsg, { t: "challenge" }>
      | undefined;
    add("challenge on an owned tile returns a tray", !!chMsg && chMsg.tray.length === TRAY_SIZE);

    if (chMsg) {
      const correct = solveTray(chMsg.tray);
      const wrong = (correct + 1) % TRAY_SIZE;

      // Wrong answer: rejected, but must NOT consume the challenge.
      clearMsgs(thief);
      thief.send({ t: "solve", req: 7, cell: tile, idx: wrong });
      await wait(200);
      add("a wrong answer is rejected", lastResult(thief)?.reason === "wrong");

      // The challenge is still open, so the correct answer now steals it.
      clearMsgs(thief);
      thief.send({ t: "solve", req: 8, cell: tile, idx: correct });
      await wait(300);
      add("a wrong answer does not consume the challenge (correct still works)", lastResult(thief)?.ok === true);
      add("the steal actually changed the owner in Redis", Number(await redis.hget("grid", String(tile))) === thief.idx);

      // Solving again cannot re-steal. The challenge was DEL'd on the successful
      // steal, but note the *reason*: the thief now owns the tile, so the
      // `own_cell` guard (which runs before the challenge check) fires first.
      // Either rejection proves the replay failed — what matters is that a
      // correct answer can never be used twice.
      clearMsgs(thief);
      thief.send({ t: "solve", req: 9, cell: tile, idx: correct });
      await wait(200);
      const replay = lastResult(thief);
      add(
        "a consumed challenge cannot be replayed",
        replay?.ok === false && (replay.reason === "own_cell" || replay.reason === "no_challenge"),
      );
    }

    owner.close();
    thief.close();
  }

  // ----------------------------------------------------------------- rate limit
  {
    const c = await open();
    clearMsgs(c);
    // Flood well past the per-second budget in one tick.
    for (let i = 0; i < 400; i++) c.send({ t: "ping" });
    await wait(400);
    const pongs = c.msgs.filter((m) => m.t === "pong").length;
    // The limiter should cap this far below 400. Budget is ~120/s.
    add("message flood is rate-limited (not all answered)", pongs > 0 && pongs < 250);

    // After the window resets, the connection works again.
    await wait(1100);
    clearMsgs(c);
    c.send({ t: "ping" });
    await wait(200);
    add("connection recovers after the rate-limit window", c.msgs.some((m) => m.t === "pong"));
    c.close();
  }

  // ------------------------------------------------- concurrent first-connections
  {
    const many = await Promise.all(Array.from({ length: 40 }, () => open()));
    const idxs = many.map((c) => c.idx);
    const distinct = new Set(idxs);
    add("40 simultaneous first-connects all get distinct player indices", distinct.size === 40);
    add("no player index is 0 (the reserved 'unclaimed' value)", !idxs.includes(0));
    for (const c of many) c.close();
  }

  // ---------------------------------------------------------------- reconnect
  {
    const first = await open();
    const myTile = 1200;
    await redis.hdel("grid", String(myTile));
    first.send({ t: "claim", cell: myTile, req: 1 });
    await wait(250);
    const token = first.token;
    const idx = first.idx;
    first.close();
    await wait(200);

    const back = await open(token);
    const snap = back.msgs.find((m) => m.t === "snapshot") as
      | Extract<ServerMsg, { t: "snapshot" }>
      | undefined;
    add("reconnecting with the same token restores the same identity", back.idx === idx);
    // The tile we claimed is in the fresh snapshot (decode not needed — it's ours
    // and the server owns the truth; just confirm identity + a live board).
    add("reconnect receives a fresh snapshot", !!snap && typeof snap.seq === "number");
    back.close();
  }

  console.log(dim("\n  edge cases:"));
  await redis.quit();
  report(checks);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

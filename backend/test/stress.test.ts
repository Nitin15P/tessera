import WebSocket from "ws";
import Redis from "ioredis";
import { CELL_COUNT } from "@tessera/shared/protocol";
import type { ServerMsg } from "@tessera/shared/protocol";
import { WS_URL, REDIS_URL, dim, green, red, report, wait } from "./harness";

/**
 * Load, throughput, and — the part that actually matters — consistency under
 * chaos.
 *
 * A pile of independent clients hammer the board with claims for a few seconds.
 * The interesting question isn't "does it go fast", it's "after all that, does
 * the board still tell one coherent story". So the headline assertion is an
 * invariant that must hold no matter how the requests interleaved:
 *
 *     number of owned tiles  ==  sum of every leaderboard score
 *
 * Every claim is +1 to the claimer and (on a steal) -1 to the previous owner,
 * all inside one atomic script, so those two totals can only stay equal if the
 * atomicity actually held under concurrency. If they drift, some claim updated
 * the tile without updating the score, or vice versa — exactly the kind of split
 * a race would cause.
 *
 * Latency and throughput are reported too, but they're context, not the point.
 *
 * Run: npm run test:stress   (tune with STRESS_CLIENTS, STRESS_MS)
 */

const N = Number(process.env["STRESS_CLIENTS"] ?? 200);
const DURATION = Number(process.env["STRESS_MS"] ?? 5000);
const CLAIM_EVERY = 40; // ms per client → ~25 attempts/s each, ~5000 msg/s total

interface Client {
  ws: WebSocket;
  idx: number;
  sent: number;
  pending: Map<number, number>; // req -> send time
  latencies: number[];
  ok: number;
  taken: number;
  noCharge: number;
  otherReject: number;
  errored: boolean;
}

function open(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const c: Client = {
      ws,
      idx: 0,
      sent: 0,
      pending: new Map(),
      latencies: [],
      ok: 0,
      taken: 0,
      noCharge: 0,
      otherReject: 0,
      errored: false,
    };
    const t = setTimeout(() => reject(new Error("connect timeout")), 15_000);

    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMsg;
      if (m.t === "welcome") c.idx = m.you.idx;
      else if (m.t === "snapshot") {
        clearTimeout(t);
        resolve(c);
      } else if (m.t === "claimResult") {
        const at = c.pending.get(m.req);
        if (at !== undefined) {
          c.latencies.push(Date.now() - at);
          c.pending.delete(m.req);
        }
        if (m.ok) c.ok++;
        else if (m.reason === "taken") c.taken++;
        else if (m.reason === "no_charges") c.noCharge++;
        else c.otherReject++;
      }
    });
    ws.on("error", () => {
      c.errored = true;
      reject(new Error("socket error during connect"));
    });
  });
}

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

async function main() {
  const redis = new Redis(REDIS_URL);
  await redis.flushall(); // a known-clean board, so the invariant math is exact

  console.log(dim(`\n  opening ${N} connections…`));
  const t0 = Date.now();

  // Connect in waves so we don't slam the accept queue (and the fd table) all at
  // once — closer to how load actually arrives, and kinder to a laptop.
  const clients: Client[] = [];
  for (let i = 0; i < N; i += 25) {
    const wave = await Promise.allSettled(
      Array.from({ length: Math.min(25, N - i) }, () => open()),
    );
    for (const r of wave) if (r.status === "fulfilled") clients.push(r.value);
    await wait(30);
  }
  console.log(dim(`  connected ${clients.length}/${N} in ${Date.now() - t0}ms`));

  // The storm: each client fires at a random free-ish cell on an interval.
  console.log(dim(`  storming for ${DURATION}ms…`));
  let req = 1;
  const stormStart = Date.now();
  const timers = clients.map((c) =>
    setInterval(() => {
      if (c.ws.readyState !== c.ws.OPEN) return;
      const cell = Math.floor(Math.random() * CELL_COUNT);
      const r = req++;
      c.pending.set(r, Date.now());
      c.sent++;
      c.ws.send(JSON.stringify({ t: "claim", cell, req: r }));
    }, CLAIM_EVERY),
  );

  await wait(DURATION);
  for (const t of timers) clearInterval(t);

  // Let the last in-flight replies and the broadcast tick settle.
  await wait(800);

  const totalSent = clients.reduce((a, c) => a + c.sent, 0);
  const totalOk = clients.reduce((a, c) => a + c.ok, 0);
  const totalTaken = clients.reduce((a, c) => a + c.taken, 0);
  const totalNoCharge = clients.reduce((a, c) => a + c.noCharge, 0);
  const totalOther = clients.reduce((a, c) => a + c.otherReject, 0);
  const totalReplies = totalOk + totalTaken + totalNoCharge + totalOther;
  const allLat = clients.flatMap((c) => c.latencies);
  const stillPending = clients.reduce((a, c) => a + c.pending.size, 0);
  const errored = clients.filter((c) => c.errored).length;
  const elapsed = (Date.now() - stormStart) / 1000;

  // The invariant.
  const gridTiles = await redis.hlen("grid");
  const lbRaw = await redis.zrange("lb", 0, -1, "WITHSCORES");
  let lbSum = 0;
  let lbNegative = false;
  for (let i = 1; i < lbRaw.length; i += 2) {
    const s = Number(lbRaw[i]);
    lbSum += s;
    if (s < 0) lbNegative = true;
  }

  // Distinct owners on the board must all be real player indices (>0).
  const owners = new Set((await redis.hvals("grid")).map(Number));
  const badOwner = [...owners].some((o) => !Number.isInteger(o) || o < 1);

  const health = (await fetch("http://localhost:8080/healthz").then((r) => r.json())) as {
    ok: boolean;
  };

  console.log("");
  console.log(`  connections        ${clients.length}`);
  console.log(`  claims sent        ${totalSent}  ${dim(`(${Math.round(totalSent / elapsed)}/s)`)}`);
  console.log(`  replies            ${totalReplies}  ${dim(`ok:${totalOk} taken:${totalTaken} noCharge:${totalNoCharge} other:${totalOther}`)}`);
  console.log(`  unanswered         ${stillPending}`);
  console.log(`  socket errors      ${errored}`);
  console.log(`  latency ms         ${dim(`p50 ${pct(allLat, 50)}  p95 ${pct(allLat, 95)}  max ${pct(allLat, 100)}`)}`);
  console.log("");
  console.log(`  owned tiles        ${gridTiles}`);
  console.log(`  leaderboard sum    ${lbSum}`);
  console.log(`  server healthy     ${health.ok}`);

  for (const c of clients) c.ws.close();
  await redis.quit();

  report([
    ["most connections survived", clients.length >= N * 0.95],
    ["no socket errors", errored === 0],
    ["server answered (few unanswered)", stillPending < totalSent * 0.02],
    ["INVARIANT: owned tiles == leaderboard sum", gridTiles === lbSum],
    ["no negative leaderboard scores", !lbNegative],
    ["every owned tile has a real owner", !badOwner],
    ["p95 latency under 250ms", pct(allLat, 95) < 250],
    ["server still healthy after the storm", health.ok === true],
  ]);
}

main().catch((err) => {
  console.error(red(String(err)));
  process.exit(1);
});

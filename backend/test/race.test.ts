import Redis from "ioredis";
import { CELL_COUNT } from "@tessera/shared/protocol";
import { connect, dim, REDIS_URL, report, send, wait, type Rig } from "./harness";

/**
 * The test the whole design exists to pass.
 *
 * Fifty independent players click the same unclaimed tile in the same instant. A
 * correct system gives it to exactly one of them and tells the other forty-nine
 * they lost. An incorrect one — anything that reads the tile, decides, then
 * writes — hands it to several people at once and leaves their screens
 * disagreeing forever, with nothing crashing and no error to notice.
 *
 * Assertions, in order of how much they matter:
 *
 *   1. Exactly one "ok". Anything else means the check-and-write came apart.
 *   2. Redis agrees with that winner.
 *   3. CONVERGENCE — all fifty clients end up displaying the same owner. This is
 *      the one that catches a system which picks a winner correctly but tells
 *      people different stories about it. Silent divergence is the real failure
 *      mode; a wrong winner is merely a bug.
 *
 * Run: npm run test:race   (server must be up)
 */

const N = 50;

async function main() {
  const redis = new Redis(REDIS_URL);

  // A tile nobody has touched, so the race is genuinely for free land.
  const cell = Math.floor(Math.random() * CELL_COUNT);
  await redis.hdel("grid", String(cell));

  console.log(dim(`\n  ${N} clients racing for tile ${cell}\n`));

  const rigs: Rig[] = await Promise.all(Array.from({ length: N }, () => connect()));
  console.log(dim(`  connected: ${rigs.length}`));

  // Fire without yielding, so the requests land on Redis together.
  for (const r of rigs) send(r, { t: "claim", cell, req: 1 });

  // Long enough for the 50ms broadcast tick to have reached everyone.
  await wait(800);

  const winners = rigs.filter((r) => r.replies.some((x) => x.ok));
  const losers = rigs.filter((r) => r.replies.length > 0 && !r.replies.some((x) => x.ok));
  const silent = rigs.filter((r) => r.replies.length === 0);
  const owner = Number(await redis.hget("grid", String(cell)));

  const reasons = new Map<string, number>();
  for (const l of losers) {
    const k = l.replies[0]?.reason ?? "?";
    reasons.set(k, (reasons.get(k) ?? 0) + 1);
  }

  // What each client actually believes about the contested tile.
  const views = new Set(rigs.map((r) => r.view.get(cell) ?? -1));

  console.log(`\n  winners            ${winners.length}`);
  console.log(
    `  losers             ${losers.length}  ${dim([...reasons].map(([k, v]) => `${k}:${v}`).join(" "))}`,
  );
  console.log(`  no reply           ${silent.length}`);
  console.log(`  redis owner        ${owner}`);
  console.log(`  winner idx         ${winners[0]?.idx ?? "—"}`);
  console.log(`  distinct views     ${views.size} ${dim(`(${[...views].join(", ")})`)}`);

  for (const r of rigs) r.close();
  await redis.quit();

  report([
    ["exactly one winner", winners.length === 1],
    ["every other request rejected", losers.length === N - 1],
    ["all rejections are 'taken'", reasons.get("taken") === N - 1],
    ["redis owner is the winner", owner === winners[0]?.idx],
    ["all clients converged on one owner", views.size === 1],
    ["clients agree with redis", views.has(owner)],
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

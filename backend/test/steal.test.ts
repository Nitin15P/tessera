import Redis from "ioredis";
import { CELL_COUNT } from "@tessera/shared/protocol";
import { connect, dim, REDIS_URL, report, send, wait, type Rig } from "./harness";

/**
 * Stealing is first-solver-wins, and a slower solver loses the race rather than
 * overwriting the winner.
 *
 * This pins the compare-and-swap in the solve path. The tile is owned by A. Two
 * players, B and C, both open a challenge against it and both solve correctly.
 * The one whose solve reaches Redis first takes it from A; the other finds the
 * tile no longer owned by A (the owner it challenged) and is rejected — without
 * spending a charge, because they solved honestly and only lost the race.
 *
 * Before the fix this was last-write-wins: both succeeded and the *slower*
 * solver ended up owning it, which rewarded solving slowly and was inconsistent
 * with free-land claims (which have always been first-come-first-served).
 *
 * The invariant that survived either way — everyone converges on one owner — is
 * checked too, because that's the thing that must never break.
 *
 * Run: npm run test:steal
 */

/** Poll until a rig has received and solved a challenge, or time out. */
async function awaitChallenge(rig: Rig, cell: number): Promise<number> {
  for (let i = 0; i < 40; i++) {
    if (rig.challenge && rig.challenge.cell === cell) return rig.challenge.answer;
    await wait(25);
  }
  throw new Error("no challenge arrived");
}

async function main() {
  const redis = new Redis(REDIS_URL);
  const cell = Math.floor(Math.random() * CELL_COUNT);
  await redis.hdel("grid", String(cell));

  const [a, b, c] = await Promise.all([connect(), connect(), connect()]);
  console.log(dim(`\n  tile ${cell} — A=${a.idx} owns, B=${b.idx} and C=${c.idx} race to steal\n`));

  // A settles the tile.
  send(a, { t: "claim", cell, req: 1 });
  await wait(300);
  const owner0 = Number(await redis.hget("grid", String(cell)));
  console.log(`  A claimed it        owner now ${owner0}`);

  // B and C both open a challenge against A's tile and solve it.
  send(b, { t: "challenge", cell, req: 2 });
  send(c, { t: "challenge", cell, req: 3 });
  const [bAns, cAns] = await Promise.all([awaitChallenge(b, cell), awaitChallenge(c, cell)]);

  // Sequence the solves so "first" is well-defined: B first, then C a beat later.
  // Both answers are correct — the question is purely who the server lets win.
  send(b, { t: "solve", req: 4, cell, idx: bAns });
  await wait(150);
  send(c, { t: "solve", req: 5, cell, idx: cAns });
  await wait(500);

  const bReply = b.replies.find((r) => r.cell === cell);
  const cReply = c.replies.find((r) => r.cell === cell);
  const finalOwner = Number(await redis.hget("grid", String(cell)));

  // A owned exactly one tile (the contested one) and just lost it to B, so A
  // should have been pruned from the leaderboard rather than left at score 0.
  const aScore = await redis.zscore("lb", String(a.idx));

  // Convergence: what every client believes the tile's owner is.
  const views = new Set([a, b, c].map((r) => r.view.get(cell) ?? finalOwner));

  console.log(`\n  B (first solver)    ${bReply?.ok ? "won" : `rejected: ${bReply?.reason}`}`);
  console.log(`  C (second solver)   ${cReply?.ok ? "won" : `rejected: ${cReply?.reason}`}`);
  console.log(`  final owner         ${finalOwner} ${dim(`(B=${b.idx}, C=${c.idx})`)}`);
  console.log(`  C's charges after   ${cReply?.charges}`);
  console.log(`  A's lb score after  ${aScore ?? "pruned (nil)"}`);
  console.log(`  distinct views      ${views.size}`);

  a.close();
  b.close();
  c.close();
  await redis.quit();

  report([
    ["the first solver wins the tile", bReply?.ok === true],
    ["the first solver owns it in Redis", finalOwner === b.idx],
    ["the second solver is rejected", cReply?.ok === false],
    ["the second solver is told 'taken'", cReply?.reason === "taken"],
    ["the second solver keeps their charge (started full)", cReply?.charges === 4],
    ["everyone converged on one owner", views.size === 1],
    ["the drained player is pruned from the leaderboard (not left at 0)", aScore === null],
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

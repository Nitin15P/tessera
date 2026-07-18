import Redis from "ioredis";
import { connect, dim, REDIS_URL, report, send, wait, type Rig } from "./harness";

/**
 * The race has an ending.
 *
 * One player claims tiles until they hold the target, and at that exact tile the
 * server must: declare them the winner to everyone, wipe the board, and clear the
 * standings — then let the next race start. This is the loop the whole feature
 * exists for, and the properties worth pinning are the ones a broken reset would
 * violate quietly:
 *
 *   1. The win fires exactly at the target, for the right player, with the right
 *      score. Not at target-1, not silently at target+1.
 *   2. The board is actually blank afterwards — not still carrying the winner's
 *      tiles, which would mean the reset wrote nothing.
 *   3. The leaderboard is empty afterwards — standings and board reset together,
 *      or they'd disagree.
 *   4. `seq` moved *forward*, never back to zero. Lowering it would masquerade as
 *      a Redis crash and trip the self-heal; the reset must be an ordinary step.
 *   5. The winner's own client received the fresh blank board (a re-sync
 *      snapshot), so it sees the new race, not a frozen old one.
 *
 * Claims are paced for the token bucket, so this necessarily takes ~a minute.
 *
 * Run: npm run test:win   (server must be up, ideally with no one else claiming)
 */

async function claimUntilWin(rig: Rig, target: number): Promise<void> {
  const claimed = new Set<number>();
  const deadline = Date.now() + 90_000;

  while (claimed.size < target && !rig.gameOver && Date.now() < deadline) {
    for (const r of rig.replies) if (r.ok) claimed.add(r.cell);
    if (claimed.size >= target) break;

    // Next tile we don't yet own. Distinct, contiguous, all in-bounds.
    const cell = claimed.size; // 0,1,2,… — we claim them in order as they land
    send(rig, { t: "claim", cell, req: cell });
    await wait(220);

    // If the bucket is empty, the reply says so — wait out a refill and retry the
    // same tile next loop. Bursts of four land instantly; the rest are paced.
    const last = [...rig.replies].reverse().find((r) => r.cell === cell);
    if (last && !last.ok && last.reason === "no_charges") await wait(1150);
  }
}

async function main() {
  const redis = new Redis(REDIS_URL);
  // Start from a blank world so nobody else's tiles count toward the race and the
  // post-reset board/leaderboard assertions are about *this* race alone.
  await redis.flushall();

  const rig = await connect();
  const target = rig.target;
  console.log(dim(`\n  player ${rig.idx} racing to ${target} tiles (paced for the bucket)…\n`));

  await claimUntilWin(rig, target);

  // Let the gameOver announcement and the reset snapshot arrive.
  await wait(800);

  const gridSize = await redis.hlen("grid");
  const lbSize = await redis.zcard("lb");
  const seqNow = Number(await redis.get("seq"));

  console.log(`  gameOver winner    ${rig.gameOver?.winnerIdx ?? "— (never fired)"}`);
  console.log(`  gameOver score     ${rig.gameOver?.score ?? "—"}`);
  console.log(`  tiles on board     ${gridSize} ${dim("(expect 0 after reset)")}`);
  console.log(`  leaderboard size   ${lbSize} ${dim("(expect 0 after reset)")}`);
  console.log(`  seq now            ${seqNow} ${dim(`(expect ≥ ${target}, never reset to 0)`)}`);
  console.log(`  winner's own view  ${rig.view.size} tiles ${dim("(expect 0 — got the blank board)")}`);

  rig.close();
  await redis.quit();

  report([
    ["a race was won", rig.gameOver !== null],
    ["the winner is the player who reached the target", rig.gameOver?.winnerIdx === rig.idx],
    ["the win fired exactly at the target score", rig.gameOver?.score === target],
    ["the board was wiped to blank", gridSize === 0],
    ["the leaderboard was cleared", lbSize === 0],
    ["seq moved forward, not back to zero", seqNow >= target],
    ["the winner's client received the fresh blank board", rig.view.size === 0],
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

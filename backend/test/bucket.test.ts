import Redis from "ioredis";
import {
  CELL_COUNT,
  CLAIM_BUCKET_MAX,
  CLAIM_REFILL_MS,
} from "@tessera/shared/protocol";
import { connect, dim, REDIS_URL, report, send, wait } from "./harness";

/**
 * The sidebar tells players "the server counts them, not your browser."
 * This is that claim, tested by doing exactly what a cheating client would do.
 *
 * The UI is bypassed entirely — no pips, no local guard, no React — and claims
 * are fired straight down the socket as fast as they'll go. A rule living in the
 * browser would let all of them through. Ours shouldn't.
 *
 * Three properties, and the middle one is the whole reason the bucket exists:
 *
 *   1. The cap binds. You cannot spend more than you have.
 *   2. You can BURST. Four tiles land instantly. A flat cooldown would have
 *      allowed exactly one — that difference is the feel of the game, and it's
 *      worth a test rather than a hope.
 *   3. Charges refill, and refill is paced. Wait, and you get exactly what you
 *      were promised: one per period, not a backlog dumped at once.
 *
 * Run: npm run test:bucket
 */

/**
 * Hand out distinct, in-bounds tiles.
 *
 * This exists because I wrote the same bug twice: ad-hoc arithmetic like
 * `base + 500` that ran off the end of the board for some random starting
 * points. It didn't fail loudly — the tile was out of range, middleware dropped
 * the message at the boundary exactly as designed, no reply ever came, and the
 * test reported a *concurrency* failure that wasn't there. A test whose own
 * arithmetic can lie about the system under test is worse than no test.
 *
 * So the allocator asserts instead of the author remembering.
 */
const BLOCK = 64; // more than this test will ever hand out

/**
 * Hand out distinct tiles from a pre-cleared block.
 *
 * This exists because I wrote the same bug twice: ad-hoc arithmetic like
 * `base + 500` that ran off the end of the board for some starting points. It
 * didn't fail loudly — the tile was out of range, middleware dropped the message
 * exactly as designed, no reply came, and the test reported a *concurrency*
 * failure that wasn't there. A test whose own arithmetic can lie about the
 * system under test is worse than no test. The allocator asserts instead.
 */
function tileAllocator(base: number) {
  let offset = 0;
  return (count = 1): number => {
    const first = base + offset;
    offset += count;
    if (offset > BLOCK) throw new Error("test exhausted its reserved tile block");
    return first;
  };
}

async function main() {
  // This test asserts certain tiles are *free*, so it must start from a clean
  // board for them. Runs share one Redis and never tidy up, so without this a
  // second run finds the first run's claims still sitting there and mis-reads
  // "taken" as a concurrency failure. Clear one contiguous block up front, in a
  // single awaited call, so it's gone before any claim is sent — a fire-and-
  // forget delete would race the claims it's meant to precede.
  const redis = new Redis(REDIS_URL);
  const base = 100 + Math.floor(Math.random() * 300);
  await redis.hdel(
    "grid",
    ...Array.from({ length: BLOCK }, (_, i) => String(base + i)),
  );

  const rig = await connect();
  const take = tileAllocator(base);

  // ---- 1. Burst: fire twice the bucket, with no throttle at all.
  const attempts = CLAIM_BUCKET_MAX * 2;
  const burstFrom = take(attempts);
  console.log(dim(`\n  bucket is ${CLAIM_BUCKET_MAX}, refill ${CLAIM_REFILL_MS}ms`));
  console.log(dim(`  firing ${attempts} claims with no client-side throttle…`));

  for (let i = 0; i < attempts; i++) send(rig, { t: "claim", cell: burstFrom + i, req: i });
  await wait(600);

  const accepted = rig.replies.filter((r) => r.ok).length;
  const refused = rig.replies.filter((r) => r.reason === "no_charges").length;
  const lastCharges = rig.replies.at(-1)?.charges;

  console.log(`  accepted           ${accepted}`);
  console.log(`  refused            ${refused}`);
  console.log(`  charges reported   ${lastCharges}`);

  // ---- 2. Refill is paced, not dumped.
  //
  // The bucket emptied at the burst (~600ms ago; the refill clock is anchored to
  // the first burst claim). Wait until we're squarely inside the window where
  // *exactly one* charge has come back — the middle of [1, 2) periods since
  // empty — then fire two claims at once. The pacing is the whole point of a
  // bucket, so this is the property worth pinning: one lands, the second is
  // refused. An empty bucket that refilled straight to full, or a flat gate that
  // never let the burst happen at all, would both fail here.
  //
  // A one-charge window rather than two on purpose: it's twice as wide in
  // relative terms, so scheduler jitter can't nudge the count across a boundary
  // and turn a correct system red. The earlier two-charge version did exactly
  // that intermittently.
  rig.replies.length = 0;
  await wait(CLAIM_REFILL_MS); // ~1800ms since empty ≈ mid of [1200, 2400)

  const refillFrom = take(2);
  send(rig, { t: "claim", cell: refillFrom, req: 50 });
  send(rig, { t: "claim", cell: refillFrom + 1, req: 51 });
  await wait(400);

  const afterWait = rig.replies.filter((r) => r.ok).length;
  console.log(`\n  after ~1 refill    ${afterWait} of 2 accepted`);

  // ---- 3. A refused claim must not cost a charge.
  //
  // Claiming a tile we already own is rejected before the bucket is touched.
  // If rejection spent a charge, losing a race would cost you twice.
  rig.replies.length = 0;
  await wait(CLAIM_REFILL_MS + 300); // bank exactly one

  send(rig, { t: "claim", cell: burstFrom, req: 90 }); // already ours -> own_cell
  await wait(250);
  const rejected = rig.replies[0];

  rig.replies.length = 0;
  send(rig, { t: "claim", cell: take(), req: 91 }); // free -> should land
  await wait(300);
  const after = rig.replies[0];

  console.log(`  rejected claim     ${rejected?.reason ?? "—"}`);
  console.log(`  next claim         ${after?.ok ? "accepted" : (after?.reason ?? "—")}`);

  // ---- 4. Garbage is dropped at the boundary, not answered.
  rig.replies.length = 0;
  send(rig, { t: "claim", cell: CELL_COUNT + 10, req: 92 });
  send(rig, { t: "claim", cell: -1, req: 93 });
  send(rig, { t: "claim", cell: 4.5, req: 94 });
  await wait(300);
  const garbage = rig.replies.length;
  console.log(`  replies to garbage ${garbage}`);

  rig.close();
  await redis.quit();

  report([
    [`burst of ${CLAIM_BUCKET_MAX} accepted at once`, accepted === CLAIM_BUCKET_MAX],
    ["the rest refused for no charges", refused === attempts - CLAIM_BUCKET_MAX],
    ["server reports an empty bucket", lastCharges === 0],
    ["one refill buys exactly one claim, not two", afterWait === 1],
    ["claiming your own tile is rejected", rejected?.reason === "own_cell"],
    ["a rejection does not spend a charge", after?.ok === true],
    ["out-of-range tiles are dropped at the boundary", garbage === 0],
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

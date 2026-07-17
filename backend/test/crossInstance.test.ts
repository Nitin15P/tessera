import { CELL_COUNT } from "@tessera/shared/protocol";
import { connect, dim, report, send, wait, WS_URL } from "./harness";

/**
 * Proves the architecture is real rather than aspirational.
 *
 * Two backend instances, one Redis. A player on instance A claims a tile; a
 * player on instance B must see it. Nothing in the process serving B knows
 * anything about A — the change reaches them only because the claim script
 * PUBLISHed inside Redis and every instance is subscribed.
 *
 * If this passes, the backend is genuinely horizontally scalable and the Lua
 * atomicity story holds behind a load balancer. If it fails, the app only ever
 * worked because everything happened to be in one process — which is exactly the
 * illusion that makes real-time systems fall over the moment they're deployed to
 * more than one box.
 *
 * Run: PORT=8081 npm run dev:backend   (in another shell)
 *      npm run test:cross
 */

const A = process.env["TEST_A"] ?? WS_URL;
const B = process.env["TEST_B"] ?? "ws://localhost:8081/ws";

async function main() {
  console.log(dim(`\n  A: ${A}\n  B: ${B}\n`));

  const [a, b] = await Promise.all([connect(A), connect(B)]);
  console.log(dim(`  connected — A is idx ${a.idx}, B is idx ${b.idx}`));

  const cell = Math.floor(Math.random() * CELL_COUNT);
  send(a, { t: "claim", cell, req: 1 });

  // Generous: a tick on A, a Redis round trip, a tick on B.
  await wait(700);

  const onA = a.view.get(cell);
  const onB = b.view.get(cell);

  console.log(`\n  tile               ${cell}`);
  console.log(`  A claimed as       ${a.idx}`);
  console.log(`  A's own view       ${onA ?? "—"}`);
  console.log(`  B's view           ${onB ?? "— (never told)"}`);

  a.close();
  b.close();

  report([
    ["instance A published the claim", onA === a.idx],
    ["instance B received it without touching A", onB === a.idx],
    ["both instances agree", onA === onB],
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { TARGET_TO_WIN } from "@tessera/shared/protocol";
import type { ClaimMsg, SolveMsg } from "@tessera/shared/protocol";
import * as claims from "../../services/claim.service";
import * as game from "../../services/game.service";
import { type Connection, send } from "../connection";

/**
 * A winning claim ends the race. The `claimResult` still goes back first — the
 * winner's own click is confirmed like any other — and then the win is declared
 * to everyone. `won` is true for exactly one claim in the whole cluster, so this
 * fires exactly once. Failures are logged, not thrown: a declared winner whose
 * reset hiccups must not tear down the socket that happened to serve the click.
 */
function maybeDeclareWinner(res: claims.ClaimResult, idx: number): void {
  if (res.ok && res.won) {
    void game
      .declareWinner(idx, TARGET_TO_WIN)
      .catch((err) => console.error("[game] declareWinner failed:", err));
  }
}

/**
 * Transport only. The rules live in claim.service and, ultimately, in Lua.
 *
 * `cell` is already validated in-bounds by middleware, so there is no re-check
 * here — the boundary validates, the interior trusts.
 *
 * The bucket rides back on every reply, win or lose. That's deliberate: a
 * rejection is exactly when a player most wants to know whether they have a
 * charge left, and piggybacking it means the pips stay honest without a
 * dedicated message or a poll.
 */

export async function handleClaim(conn: Connection, msg: ClaimMsg): Promise<void> {
  const res = await claims.settle(conn.player, msg.cell);

  send(conn.ws, {
    t: "claimResult",
    req: msg.req,
    cell: msg.cell,
    ok: res.ok,
    ...(res.ok ? {} : { reason: res.reason }),
    charges: res.charges,
    nextChargeMs: res.nextChargeMs,
  });

  maybeDeclareWinner(res, conn.player.idx);
}

export async function handleSolve(conn: Connection, msg: SolveMsg): Promise<void> {
  const res = await claims.solve(conn.player, msg.cell, msg.idx);

  send(conn.ws, {
    t: "claimResult",
    req: msg.req,
    cell: msg.cell,
    ok: res.ok,
    ...(res.ok ? {} : { reason: res.reason }),
    charges: res.charges,
    nextChargeMs: res.nextChargeMs,
  });

  maybeDeclareWinner(res, conn.player.idx);
}

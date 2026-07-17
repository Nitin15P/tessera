import type { ChallengeReqMsg } from "@tessera/shared/protocol";
import * as claims from "../../services/claim.service";
import { type Connection, send } from "../connection";

/**
 * Issue a steal challenge.
 *
 * A rejection comes back as a `claimResult` rather than a bespoke error type:
 * from the client's point of view "I tried to take that tile and couldn't" is
 * one outcome, and giving it one shape means the optimistic layer has one place
 * to clean up.
 */
export async function handleChallenge(
  conn: Connection,
  msg: ChallengeReqMsg,
): Promise<void> {
  const res = await claims.openChallenge(conn.player, msg.cell);

  if (!res.ok) {
    send(conn.ws, {
      t: "claimResult",
      req: msg.req,
      ok: false,
      cell: msg.cell,
      reason: res.reason,
      charges: res.charges,
      nextChargeMs: res.nextChargeMs,
    });
    return;
  }

  send(conn.ws, {
    t: "challenge",
    req: msg.req,
    cell: msg.cell,
    tray: res.tray,
    expiresMs: res.expiresMs,
  });
}

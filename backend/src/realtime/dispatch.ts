import type { Middleware } from "../middleware";
import { send } from "./connection";
import {
  handleChallenge,
  handleClaim,
  handleCursor,
  handleSetProfile,
  handleSolve,
} from "./handlers";

/**
 * The end of the chain: a validated message meets the code that acts on it.
 *
 * Written as a middleware so it composes with everything before it and gets the
 * error boundary for free. It never calls `next()` — nothing runs after dispatch.
 *
 * The switch is exhaustive over ClientMsg. If a message type is added to the
 * protocol and not handled here, `never` in the default branch fails the build
 * rather than the message being silently ignored at runtime.
 */
export const dispatch: Middleware = async (ctx) => {
  const { conn } = ctx;
  const msg = ctx.msg;
  if (!msg) return; // unreachable: validate() runs first and stops the chain otherwise

  switch (msg.t) {
    case "claim":
      return handleClaim(conn, msg);
    case "challenge":
      return handleChallenge(conn, msg);
    case "solve":
      return handleSolve(conn, msg);
    case "cursor":
      return handleCursor(conn, msg);
    case "setProfile":
      return handleSetProfile(conn, msg);
    case "ping":
      return send(conn.ws, { t: "pong" });
    default: {
      const unreachable: never = msg;
      throw new Error(`Unhandled message: ${JSON.stringify(unreachable)}`);
    }
  }
};

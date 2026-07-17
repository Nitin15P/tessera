import type { Middleware } from "./types";

/**
 * The outermost link in the chain.
 *
 * One socket sending one bad message must never take the process down, and an
 * unhandled rejection in an async handler will do exactly that under Node's
 * default. Catching here rather than at each call site means a new handler is
 * covered the moment it is written, instead of the moment someone remembers.
 *
 * The connection survives: a thrown handler is a bug on our side, and punishing
 * the player for it by dropping their board would be the wrong trade.
 */
export const errorBoundary: Middleware = async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error(
      `[ws] handler threw for ${ctx.conn.player.name} (${ctx.msg?.t ?? "unparsed"}):`,
      err,
    );
  }
};

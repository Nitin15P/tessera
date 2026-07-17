import type { ClientMsg } from "@tessera/shared/protocol";
import type { Connection } from "../realtime/connection";

/**
 * The inbound pipeline.
 *
 * Every message from every socket passes through the same ordered chain before
 * any handler sees it. Previously these concerns were smeared across the
 * connection handler — a rate-limit decrement in a closure, `inBounds` checks
 * repeated inside each handler, JSON.parse in a try/catch beside the dispatch —
 * which made it impossible to answer "what protects this socket?" without
 * reading everything.
 *
 * Same idea as HTTP middleware, adapted to a persistent connection: a raw frame
 * goes in, and either a validated message reaches the handler or the chain stops
 * it. `next()` is not called on rejection, and rejection is silent by default —
 * a misbehaving client is not owed an explanation, and replying to a flood is
 * how a flood becomes an amplification.
 */

/** Per-connection scratch space owned by middleware, not by handlers. */
export interface MiddlewareState {
  /** Remaining inbound-message budget for the current window. */
  budget: number;
  windowStartedAt: number;
}

export interface Context {
  conn: Connection;
  /** The raw frame, before parsing. */
  raw: string;
  /** Populated by `parse`; guaranteed present downstream of it. */
  msg?: ClientMsg;
}

export type Next = () => Promise<void> | void;

export type Middleware = (ctx: Context, next: Next) => Promise<void> | void;

/**
 * Compose an ordered chain. A middleware that doesn't call `next()` ends the
 * message — no exceptions, no unwinding, no partial dispatch.
 */
export function compose(chain: Middleware[]): (ctx: Context) => Promise<void> {
  return async (ctx: Context) => {
    let i = -1;
    const run = async (n: number): Promise<void> => {
      // Guards against a middleware calling next() twice, which would otherwise
      // silently double-dispatch the same claim.
      if (n <= i) throw new Error("next() called more than once");
      i = n;
      const fn = chain[n];
      if (!fn) return;
      await fn(ctx, () => run(n + 1));
    };
    await run(0);
  };
}

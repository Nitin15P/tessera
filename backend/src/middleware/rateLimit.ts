import { limits } from "../config/env";
import type { Middleware } from "./types";

/**
 * A per-connection message budget.
 *
 * Worth being precise about what this is *not*: it is not a game rule. The
 * cooldown is the game rule, it lives in Lua, and it is what stops a player
 * claiming too fast. This exists one layer down, to stop a socket drowning the
 * process in JSON.parse work — a resource guard, nothing more.
 *
 * Conflating the two would be a mistake in both directions: a rate limit here
 * that enforced game pacing would be bypassable by opening a second socket, and
 * a cooldown that also protected the process would have to be tuned for two
 * incompatible jobs.
 *
 * A fixed window rather than a token bucket: a burst of 2× at a window boundary
 * is completely harmless for a parse guard, and the simpler thing is the thing
 * that stays correct.
 */
export const rateLimit: Middleware = (ctx, next) => {
  const now = Date.now();
  const state = ctx.conn.mw;

  if (now - state.windowStartedAt >= 1000) {
    state.windowStartedAt = now;
    state.budget = limits.msgsPerSecond;
  }

  if (state.budget <= 0) {
    // Dropped in silence. A well-behaved client never reaches this, and telling
    // a flooding one about it just doubles the traffic.
    return;
  }

  state.budget--;
  return next();
};

import { CONTROL_CHANNEL, subscriber } from "../db/redis";
import * as board from "../services/board.service";
import * as bot from "../services/bot.service";
import * as players from "../services/player.service";
import { broadcastGameOver, toPublic } from "./broadcaster";

/**
 * The realtime end of the control channel.
 *
 * Game events (a race was won, the board was reset) are published cluster-wide by
 * the game service; this is where each instance turns them into things its own
 * connected clients see. It lives in the realtime layer, not the service layer,
 * because reacting means broadcasting and re-hydrating — both of which the
 * services deliberately don't reach back into. Every instance runs this and
 * reacts identically, so the instance that served the winning click is not
 * special: it hears its own announcement on the same channel as everyone else.
 */

async function handle(raw: string): Promise<void> {
  const [kind, ...rest] = raw.split(":");

  if (kind === "gameOver") {
    // Resolve the winner locally — the announcement carries only the index, so a
    // name containing a colon can never corrupt the message. Fetch-through in
    // case this instance has never seen the winner before.
    const idx = Number(rest[0]);
    const score = Number(rest[1]);
    const player = players.getCached(idx) ?? (await players.get(idx));
    if (player) broadcastGameOver(toPublic(player), score);
    return;
  }

  if (kind === "roundReset") {
    // Re-read the now-blank board and push it to every client. `hydrate("reset")`
    // re-syncs connected clients when it was already serving, which after a reset
    // it always is — so the fresh empty grid lands under the winner banner.
    await board.hydrate("reset");
    // Hold the bot out through the banner and a headstart, so it isn't filling the
    // fresh board while the human is still watching the result.
    bot.onRoundReset();
    return;
  }
}

/** Subscribe to the control channel. Called once at boot, after the board is ready. */
export async function start(): Promise<void> {
  subscriber.on("message", (channel: string, raw: string) => {
    if (channel !== CONTROL_CHANNEL) return;
    void handle(raw);
  });
  await subscriber.subscribe(CONTROL_CHANNEL);
}

import { CONTROL_CHANNEL, boardRepo, redis } from "../db/redis";

/**
 * The race, as a service: someone won, so end it.
 *
 * Deliberately thin and transport-agnostic, like the claim service. It knows how
 * to *announce* a win and *reset* the board, but not who is connected — the
 * realtime layer listens on the control channel and turns these announcements
 * into client messages. Keeping it here means the game rule can be triggered and
 * tested without a socket, and the same reset can't be implemented two ways.
 *
 * The win itself is detected inside the atomic claim script (see claim.lua), so
 * this is only ever called once per race, by whichever instance served the
 * winning click.
 */

/**
 * Declare the winner and reset the board.
 *
 * Order matters: the `gameOver` announcement goes out first, then the reset
 * (which announces its own `roundReset`). Both ride the one control channel in
 * that order, so every instance — this one included — sees the winner before the
 * blank board and can show the banner over the fresh grid rather than after it.
 *
 * The reset is idempotently locked in Redis, so a second simultaneous winner
 * clearing the board is harmless; we still announce their `gameOver`, and the
 * later banner simply wins.
 */
export async function declareWinner(idx: number, score: number): Promise<void> {
  await redis.publish(CONTROL_CHANNEL, `gameOver:${idx}:${score}`);
  await boardRepo.resetGame();
}

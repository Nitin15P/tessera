import captureUrl from "./assets/capture.mp3";

/**
 * Sound effects.
 *
 * Deliberately tiny. Playback is only ever triggered by a user gesture — you
 * click the odd shape (or press its number) to solve the steal challenge — so
 * the browser's autoplay policy is satisfied and no unlock dance is needed.
 *
 * One reused Audio element per effect, rewound before each play so rapid steals
 * retrigger it cleanly. The play() promise is swallowed: a blocked, interrupted,
 * or unsupported sound must never surface as an error to the player.
 */
const capture = new Audio(captureUrl);
capture.preload = "auto";
capture.volume = 0.55;

/** Plays only on a *successful* steal — see net/socket.ts. */
export function playCapture(): void {
  capture.currentTime = 0;
  void capture.play().catch(() => {
    /* autoplay blocked / interrupted — a missing sound isn't worth surfacing */
  });
}

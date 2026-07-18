import { store } from "../../state/store";
import { useStore } from "../../app/useStore";

/**
 * The race result.
 *
 * When a player reaches the target the server declares them the winner and
 * resets the board; this is the moment that gives the whole loop its point. It
 * mirrors the challenge overlay deliberately (same scrim, same sheet-in), so the
 * two full-screen states feel like one family.
 *
 * The banner is cleared on a timer in the socket layer, not by a dismiss button:
 * the fresh, blank board is already settling underneath while it shows, so when
 * it fades the next race is simply revealed, already live. The scrim covering the
 * board is what turns those few seconds into an intermission, no server-side lock
 * required.
 */
export function WinnerOverlay() {
  useStore();
  const w = store.winner;
  if (!w) return null;

  return (
    <div className="scrim">
      <div
        className="winner"
        role="dialog"
        aria-label={`${w.player.name} won the board with ${w.score} tiles`}
      >
        <span className="winner-eyebrow">Race won</span>
        <span className="winner-swatch" style={{ background: w.player.color }} aria-hidden />
        <h2 className="winner-name" style={{ color: w.player.color }}>
          {w.player.name}
        </h2>
        <span className="winner-line">
          first to hold {w.score} tiles
        </span>
        <span className="winner-next">New race starting</span>
      </div>
    </div>
  );
}

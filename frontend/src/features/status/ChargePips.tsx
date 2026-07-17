import { useEffect, useState } from "react";
import { store } from "../../state/store";

/**
 * The bucket, made visible.
 *
 * Four pips. Full ones are your colour; the next one to land fills gradually, so
 * the wait is legible without a number counting down at you. When you're full,
 * nothing animates at all — which is most of the time, and is the whole point of
 * choosing a bucket over a flat gate.
 *
 * This is the one place in the app that animates on a timer rather than from
 * server state, because refill is the one thing that happens *without* anything
 * being sent. It ticks at 10Hz — enough for a smooth-looking fill, far below the
 * board's 60fps, and it costs nothing because it only touches four small divs.
 */
export function ChargePips() {
  // Local tick: this component's job is to show time passing, and time passes
  // whether or not the store changes.
  const [, force] = useState(0);

  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);

  if (!store.me) return null;

  const now = Date.now();
  const charges = store.chargesNow(now);
  const fraction = store.refillFraction(now);
  const color = store.me.color;

  return (
    <div
      className="pips"
      title={`${charges} of ${store.bucketMax} charges`}
      role="img"
      aria-label={`${charges} of ${store.bucketMax} claim charges available`}
    >
      {Array.from({ length: store.bucketMax }, (_, i) => {
        const full = i < charges;
        // Exactly one pip is mid-refill: the next one due.
        const filling = i === charges && fraction > 0;
        return (
          <span key={i} className={`pip${full ? " pip-full" : ""}`}>
            <span
              className="pip-fill"
              style={{
                background: color,
                // A full pip is simply a filling one at 100% — same element, no
                // separate "full" rendering path to disagree with the animation.
                transform: `scaleY(${full ? 1 : filling ? fraction : 0})`,
              }}
            />
          </span>
        );
      })}
    </div>
  );
}

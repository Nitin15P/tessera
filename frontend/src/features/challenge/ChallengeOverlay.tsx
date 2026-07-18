import { useEffect, useState } from "react";
import type { TrayShape } from "@tessera/shared/domain";
import { store } from "../../state/store";
import { cancelChallenge, solve } from "../../net/socket";
import { useStore } from "../../app/useStore";

/**
 * The steal challenge.
 *
 * Nine shapes, one different. Click it and the tile is yours.
 *
 * It is worth being clear about what this is and isn't. It is a *cost* on
 * stealing — free land is free, taking someone's land should not be. It is not
 * conflict resolution: two players can both solve challenges for the same tile,
 * and the atomic Lua script still decides who actually gets it. Anyone who says
 * a puzzle resolves a race has moved the race, not removed it.
 *
 * Nor is it cheat-proof, and pretending otherwise would be worse than not having
 * it. The answer never leaves the server, but the tray is rendered on the client,
 * so a script could diff the shapes and click for you. That is unavoidable for
 * any client-rendered visual challenge. The cooldown is the real backstop: a
 * perfect bot still only steals once every three seconds.
 */
export function ChallengeOverlay() {
  useStore();
  const ch = store.challenge;
  const [left, setLeft] = useState(1);

  useEffect(() => {
    if (!ch) return;
    const id = setInterval(() => {
      const frac = (ch.expiresAt - Date.now()) / ch.durationMs;
      if (frac <= 0) {
        cancelChallenge();
        store.toast("Challenge expired");
      } else setLeft(frac);
    }, 60);
    return () => clearInterval(id);
  }, [ch]);

  useEffect(() => {
    if (!ch) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelChallenge();
      // 1-9 mirror the tray's reading order, so this is playable without a mouse
      // even though the board behind it isn't.
      const n = Number(e.key);
      if (n >= 1 && n <= 9) solve(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ch]);

  if (!ch) return null;

  const victim = store.playerAt(store.confirmed[ch.cell] ?? 0);

  return (
    <div className="scrim" onPointerDown={cancelChallenge}>
      <div
        className="challenge"
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Find the odd one out to steal this tile"
      >
        <div className="challenge-head">
          <span className="challenge-title">Find the odd one out</span>
          {victim && (
            <span className="challenge-sub">
              to take this tile from{" "}
              <b style={{ color: victim.color }}>{victim.name}</b>
            </span>
          )}
        </div>

        <div className="tray">
          {ch.tray.map((s, i) => (
            <button
              key={i}
              className="tray-cell"
              onPointerDown={(e) => {
                e.stopPropagation();
                solve(i);
              }}
              aria-label={`Shape ${i + 1}`}
            >
              <Shape s={s} />
            </button>
          ))}
        </div>

        {/* An expiring challenge should feel like it's expiring. */}
        <div className="timer">
          <div className="timer-fill" style={{ transform: `scaleX(${Math.max(0, left)})` }} />
        </div>
      </div>
    </div>
  );
}

const PATHS: Record<TrayShape["type"], string> = {
  square: "M -13 -13 H 13 V 13 H -13 Z",
  triangle: "M 0 -15 L 14 10 L -14 10 Z",
  hex: "M 15 0 L 7.5 13 L -7.5 13 L -15 0 L -7.5 -13 L 7.5 -13 Z",
  circle: "",
};

function Shape({ s }: { s: TrayShape }) {
  // Muted saturation to match the de-neoned palette — the odd-one-out hue shift
  // the server bakes in (~40-50°) still reads clearly at this saturation.
  const fill = `hsl(${s.hue} 45% 58%)`;
  return (
    <svg viewBox="-22 -22 44 44" aria-hidden>
      <g transform={`rotate(${s.rot})`}>
        {s.type === "circle" ? (
          <circle r="14" fill={fill} />
        ) : (
          <path d={PATHS[s.type]} fill={fill} />
        )}
      </g>
    </svg>
  );
}

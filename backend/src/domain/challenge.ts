import { TRAY_SIZE } from "@tessera/shared/protocol";
import type { ShapeType, TrayShape } from "@tessera/shared/domain";

/**
 * The steal challenge: nine shapes, one of them different. Click it.
 *
 * Design constraints, in priority order:
 *
 *  - No prior knowledge. Not arithmetic, not language, not trivia. Someone who
 *    has never seen the app is on equal footing with someone who has played for
 *    an hour. It tests looking, and nothing else.
 *  - Roughly one second. A steal is a beat in a fast game, not a puzzle break.
 *    Anything that stops play to be *solved* is the wrong mechanic here.
 *  - Latency-independent. Deliberately not a timing/reflex bar: those make a
 *    player on a slow connection genuinely worse at the game, which is a
 *    grotesque property for a real-time app to have.
 *  - Server-generated, server-verified. The answer never leaves this process.
 *
 * What this does NOT do is resolve conflicts. Two players can both solve
 * challenges for the same cell; the atomic Lua script still decides who wins.
 * The challenge gates who may *try*. Anyone who tells you a puzzle resolves a
 * race has moved the race, not removed it.
 */

/**
 * Rotational symmetry in degrees. Rotating a square by 90° is a no-op, so a
 * rotation delta must stay well inside the symmetry period or the "odd" shape
 * is identical to its neighbours and the challenge is unanswerable.
 *
 * A circle's symmetry is continuous — rotation is invisible — so circles can
 * only ever differ by hue.
 */
const SYMMETRY: Record<ShapeType, number> = {
  triangle: 120,
  square: 90,
  hex: 60,
  circle: 0,
};

const TYPES = Object.keys(SYMMETRY) as ShapeType[];

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export interface Challenge {
  tray: TrayShape[];
  /** Tray position of the odd one out. Stays server-side. */
  answer: number;
}

export function generateChallenge(): Challenge {
  const type = pick(TYPES);
  const symmetry = SYMMETRY[type];

  // Circles can't express rotation, so they must differ by hue.
  const mode: "hue" | "rot" = symmetry === 0 ? "hue" : Math.random() < 0.5 ? "hue" : "rot";

  const baseHue = Math.floor(rand(0, 360));
  const baseRot = symmetry === 0 ? 0 : Math.floor(rand(0, symmetry));
  const answer = Math.floor(Math.random() * TRAY_SIZE);

  // Tuned by eye: large enough to spot in about a second without hunting,
  // small enough that it isn't free. Sign is randomised so the odd shape isn't
  // always the brighter or the more-tilted one.
  const dir = Math.random() < 0.5 ? -1 : 1;
  const hueDelta = dir * rand(38, 52);
  // ~28% of the symmetry period: clearly not the same, clearly not aligned to
  // the next symmetric position.
  const rotDelta = dir * symmetry * 0.28;

  const tray: TrayShape[] = Array.from({ length: TRAY_SIZE }, (_, i) => {
    const odd = i === answer;
    return {
      type,
      hue: Math.round((baseHue + (odd && mode === "hue" ? hueDelta : 0) + 360) % 360),
      rot: Math.round(baseRot + (odd && mode === "rot" ? rotDelta : 0)),
    };
  });

  return { tray, answer };
}

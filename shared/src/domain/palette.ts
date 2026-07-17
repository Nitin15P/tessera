/**
 * Player colours.
 *
 * Sixteen evenly-spaced hues (the Tailwind 500 ramp), chosen because they are
 * already tuned for distinguishability and all clear contrast against the dark
 * board background. Sixteen is the practical ceiling — past that, adjacent hues
 * stop being tellable apart at 18px, and a grid you can't read is a grid that
 * failed at its one job.
 *
 * Index 0 is reserved: it means unclaimed, and is never assigned to a player.
 * Assignment wraps, so player 17 shares a colour with player 1 — names
 * disambiguate. Consciously accepted; the alternative is generating colours at
 * runtime and losing the contrast guarantee.
 */
export const PALETTE = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#eab308", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#10b981", // emerald
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#d946ef", // fuchsia
  "#ec4899", // pink
] as const;

/**
 * The board itself — a cell nobody owns.
 *
 * Neutral grays, not the faintly blue tones they were: the chrome around the
 * board is neutral (Apple's system grays are near-hueless), and a blue cast on
 * the board surface reads as a slightly different world. Three steps of one
 * neutral ramp — page darkest, board surface mid, unclaimed tile lightest — so
 * the 1px gaps between tiles read as hairline grid lines and the board looks lit
 * rather than pasted on.
 */
export const UNCLAIMED_COLOR = "#242426";
export const BOARD_BG = "#161617";
export const GRID_LINE = "#2b2b2d";

export function colorFor(playerIdx: number): string {
  const n = PALETTE.length;
  // Double-mod normalises negatives; JS % keeps the sign of the dividend.
  const i = (((playerIdx - 1) % n) + n) % n;
  return PALETTE[i]!;
}

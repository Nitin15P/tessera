/**
 * Player colours.
 *
 * Sixteen muted, evenly-spaced hues — a risograph / muted-jewel set rather than
 * the old bright Tailwind-500 ramp, which read as neon on a near-black board.
 * Saturation sits around 40% and lightness around 58%, so every colour is
 * clearly distinguishable at 18px but none of them shouts. Sixteen is the
 * practical ceiling: past it, adjacent hues stop being tellable apart, and a
 * grid you can't read is a grid that failed at its one job.
 *
 * Index 0 is reserved: it means unclaimed, and is never assigned to a player.
 * Assignment wraps, so player 17 shares a colour with player 1 — names
 * disambiguate. Consciously accepted; generating colours at runtime would lose
 * the distinguishability guarantee.
 */
export const PALETTE = [
  "#c15a52", // brick red
  "#cb7a49", // rust
  "#c69a55", // ochre
  "#b0a552", // olive gold
  "#8fa957", // moss
  "#64a465", // fern green
  "#48a186", // jade
  "#479ba4", // teal
  "#5090b3", // steel blue
  "#5f7fbb", // dusty blue
  "#7a70bb", // muted indigo
  "#9469b2", // amethyst
  "#ac66a4", // orchid
  "#bd6293", // muted magenta
  "#c26089", // dusty rose
  "#c35d6a", // clay
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

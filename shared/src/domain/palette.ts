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

/**
 * Pull an arbitrary colour into the palette's readable band.
 *
 * Players may pick any colour, but the board only stays legible if every tile
 * sits in the same muted-jewel range the sixteen presets do — too bright and it
 * neons against the near-black grid, too dark and it vanishes into it. So we keep
 * the *hue* the player chose (the part that carries their intent) and clamp
 * saturation and lightness into the band. Shared, so the picker previews exactly
 * what the server will store; run authoritatively there, since colour arrives over
 * a socket and cannot be trusted to already be in range.
 */
const SAT_MIN = 30;
const SAT_MAX = 52;
const LIGHT_MIN = 50;
const LIGHT_MAX = 64;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function sanitizeColor(input: string): string {
  const rgb = parseHex(input);
  if (!rgb) return PALETTE[0]!; // unreadable/garbage input falls back to a preset
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  return hslToHex(h, clamp(s, SAT_MIN, SAT_MAX), clamp(l, LIGHT_MIN, LIGHT_MAX));
}

/** Accepts #rgb or #rrggbb (case-insensitive). Returns 0-255 channels or null. */
function parseHex(input: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let hex = m[1]!;
  if (hex.length === 3) hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/** r,g,b in 0-255 -> h in 0-360, s/l in 0-100. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s * 100, l * 100];
}

/** Hue (0-360) of a hex colour, or null if it can't be parsed. */
function hueOf(hex: string): number | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2])[0] : null;
}

/** Shortest distance between two hues on the colour wheel, 0-180. */
const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Below this many degrees apart, two muted colours read as the same shade. */
const SAME_SHADE = 34;

/**
 * A palette colour visually distinct from the ones already in play.
 *
 * The board only tells players apart by colour, and the resident bot is always
 * brick red — so a new player seated on an adjacent (or duplicate) hue reads as its
 * twin. This picks the palette entry with the widest gap to every taken hue, so a
 * newcomer lands as far from the crowd as the sixteen colours allow. Ties break at
 * random, so repeated joins into an empty room don't all get the same colour.
 */
export function pickDistinctColor(taken: readonly string[]): string {
  const takenHues = taken.map(hueOf).filter((h): h is number => h !== null);
  const order = [...PALETTE].sort(() => Math.random() - 0.5);
  if (takenHues.length === 0) return order[0]!;

  let best = order[0]!;
  let bestGap = -1;
  for (const c of order) {
    const gap = Math.min(...takenHues.map((t) => hueGap(hueOf(c)!, t)));
    if (gap > bestGap) {
      bestGap = gap;
      best = c;
    }
  }
  return best;
}

/**
 * Keep `current` if it already stands clear of every colour in `taken`; otherwise
 * suggest a distinct palette colour. Lets a player who deliberately chose a good
 * colour keep it, while nudging anyone who'd clash (a fresh sequential default, or
 * a colour too near the bot) onto something legible.
 */
export function distinctFrom(current: string, taken: readonly string[]): string {
  const h = hueOf(current);
  const takenHues = taken.map(hueOf).filter((x): x is number => x !== null);
  if (h !== null && takenHues.every((t) => hueGap(h, t) >= SAME_SHADE)) return current;
  return pickDistinctColor(taken);
}

/** h in 0-360, s/l in 0-100 -> #rrggbb. */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

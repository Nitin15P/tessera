/**
 * Player names.
 *
 * Pure and I/O-free, so it sits in domain rather than in the player service that
 * happens to call it. Names exist because sixteen colours cannot disambiguate an
 * unbounded number of players — past the palette, the name is the identity.
 */

const ADJECTIVES = [
  "Wandering", "Restless", "Quiet", "Distant", "Golden", "Hollow", "Drifting",
  "Patient", "Sudden", "Copper", "Velvet", "Crooked", "Solemn", "Amber",
  "Curious", "Reckless", "Silent", "Clever", "Fearless", "Idle",
] as const;

const ANIMALS = [
  "Otter", "Heron", "Marten", "Falcon", "Badger", "Lynx", "Magpie", "Vixen",
  "Ibex", "Raven", "Stoat", "Osprey", "Wolf", "Crane", "Hare", "Shrike",
  "Puffin", "Adder", "Kestrel", "Marmot",
] as const;

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** 400 combinations. Collisions are possible and harmless — the index is the
 *  real identity; the name is only for humans. */
export const generateName = (): string => `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;

/** Longest name that still fits the identity chip and leaderboard row without
 *  the layout leaning on ellipsis for every entry. */
const MAX_NAME_LEN = 20;

// \p{Cc} is the Unicode "control" category — newlines, tabs, escape sequences that
// could break a label if they reached the DOM. Using the property escape keeps
// this source free of any literal control byte.
const CONTROL_CHARS = /\p{Cc}/gu;
const WHITESPACE_RUN = /\s+/g;

/**
 * Clean a player-supplied name. Names arrive over a socket, so they're untrusted:
 * strip control characters, collapse whitespace, and cap the length. An empty
 * result falls back to a fresh generated name rather than an anonymous blank.
 */
export function sanitizeName(raw: string): string {
  const cleaned = raw
    .replace(CONTROL_CHARS, " ")
    .replace(WHITESPACE_RUN, " ")
    .trim()
    .slice(0, MAX_NAME_LEN)
    .trim();
  return cleaned.length > 0 ? cleaned : generateName();
}

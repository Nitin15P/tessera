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

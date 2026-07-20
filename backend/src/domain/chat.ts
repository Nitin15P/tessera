/**
 * Cleaning chat text.
 *
 * Pure and I/O-free, so it sits in domain rather than in the handler that happens
 * to call it. Chat arrives over a socket from strangers on a public board, so it
 * is treated as hostile: control characters stripped (they could smuggle newlines
 * or escape sequences into the DOM), length capped, and the obvious profanity
 * masked before anyone else ever sees it.
 *
 * The mask is deliberately small and word-boundary-anchored — it is not real
 * moderation and does not pretend to be. It catches the low-effort stuff without
 * the false positives a naive substring filter produces (the "Scunthorpe" trap).
 */

/** Long enough for a real sentence, short enough not to blow out the panel. */
const MAX_CHAT_LEN = 200;

// \p{Cc} is the Unicode "control" category (newlines, tabs, escapes). Property
// escape keeps this source free of any literal control byte.
const CONTROL_CHARS = /\p{Cc}/gu;
const WHITESPACE_RUN = /\s+/g;

/**
 * Trim, flatten to a single line, drop control characters, and cap the length.
 * Returns "" for input that is empty or all whitespace — the caller drops those.
 */
export function sanitizeChat(raw: string): string {
  return raw
    .replace(CONTROL_CHARS, " ")
    .replace(WHITESPACE_RUN, " ")
    .trim()
    .slice(0, MAX_CHAT_LEN)
    .trim();
}

// A small, intentionally short list of slurs and hard profanity. Kept minimal on
// purpose — the goal is to blunt the obvious, not to police language.
const BLOCKED = [
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "asshole",
  "dick",
  "nigger",
  "nigga",
  "faggot",
  "fag",
  "retard",
  "slut",
  "whore",
];

// One case-insensitive, word-boundary-anchored pattern. Boundaries mean "class"
// and "assassin" are safe while the words themselves are caught.
const PROFANITY = new RegExp(`\\b(${BLOCKED.join("|")})\\b`, "gi");

/** Replace blocked words with asterisks of the same length, so the shape of the
 *  sentence survives but the word doesn't. */
export function maskProfanity(text: string): string {
  return text.replace(PROFANITY, (word) => "*".repeat(word.length));
}

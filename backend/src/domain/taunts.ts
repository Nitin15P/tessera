/**
 * The bot's trash talk.
 *
 * Curated, game-only lines in an over-the-top boastful register — a caricature for
 * a tile game, and nothing more. Every line is about the board (claiming, stealing,
 * winning); none touches anything real-world. Because they're hand-written and safe
 * by construction, they skip the chat sanitiser and go straight out.
 */

export const GENERAL_TAUNTS = [
  "Nobody claims tiles better than me. Nobody.",
  "This board is going to be tremendous. Believe me.",
  "I'm taking these tiles, and I'm taking them bigly.",
  "So many tiles. The best tiles. Everyone says so.",
  "Watch and learn, folks. Watch and learn.",
  "That was a beautiful steal. A perfect steal.",
  "Your tiles? They're my tiles now.",
  "We're going to win so much you'll get tired of winning.",
  "Weak claiming. Very weak. Sad!",
  "I wrote the art of the tile. Tremendous book.",
  "Believe me, this grid loves me.",
  "Some people say I'm the greatest tile player ever. I don't disagree.",
] as const;

export const WIN_TAUNTS = [
  "I won. Bigly. Nobody's surprised.",
  "Total victory. The best victory. Everyone's talking about it.",
  "Fifty tiles. Tremendous. Nobody does it like me.",
  "Winning is what I do, folks. Get used to it.",
  "That's how you take a board. Believe me.",
] as const;

export const randomTaunt = (list: readonly string[]): string =>
  list[Math.floor(Math.random() * list.length)]!;

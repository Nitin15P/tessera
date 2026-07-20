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

/** Someone just stole one of his tiles. */
export const STOLEN_FROM = [
  "You took a tile? Enjoy it. It won't last.",
  "Nasty little steal. I'll take it right back, believe me.",
  "That tile was mine. It will be mine again. Sad for you.",
  "A steal? Rookie stuff. Watch this.",
] as const;

// ---- replies to what players say in chat --------------------------------

const REPLY_GENERIC = [
  "Wrong.",
  "We'll see about that, folks.",
  "Believe me, I've heard better.",
  "You keep typing. I'll keep winning.",
  "Low energy. Very low.",
  "Big talk. Show me the tiles.",
  "Nobody chats like me. It's true.",
] as const;

const REPLY_QUESTION = [
  "Great question. The answer is: I win.",
  "Ask me anything. I know tiles better than anyone.",
  "The answer is tremendous. Next.",
] as const;

const REPLY_BRAG = [
  "You? Win? That's cute, folks.",
  "The only winner here is me. Believe me.",
  "Winning is my word. Get your own.",
] as const;

const REPLY_MOCK = [
  "Sad!",
  "Losing is a mindset. You've mastered it.",
  "Not everyone can be a winner. Most can't.",
] as const;

const REPLY_GREETING = [
  "Welcome, folks. You're going to lose bigly. Enjoy!",
  "Great to have you. Now watch a professional work.",
  "Hello! Prepare to be out-tiled.",
] as const;

/**
 * A reply to a player's chat line, in character. Lightly keyword-aware — a
 * question, a boast, some trash talk, a greeting — falling back to a generic quip.
 * Read-only pattern-matching on the (already sanitised) text; nothing it says
 * depends on trusting the input.
 */
export function pickReply(text: string): string {
  const t = text.toLowerCase();
  if (/\?\s*$/.test(text)) return randomTaunt(REPLY_QUESTION);
  if (/\b(win|winning|won|beat|first|best)\b/.test(t)) return randomTaunt(REPLY_BRAG);
  if (/\b(lose|losing|lost|bad|sad|worst|suck|trash)\b/.test(t)) return randomTaunt(REPLY_MOCK);
  if (/\b(hi|hey|hello|yo|sup|gg|hola)\b/.test(t)) return randomTaunt(REPLY_GREETING);
  return randomTaunt(REPLY_GENERIC);
}

export const randomTaunt = (list: readonly string[]): string =>
  list[Math.floor(Math.random() * list.length)]!;

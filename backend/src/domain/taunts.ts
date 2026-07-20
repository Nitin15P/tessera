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

/**
 * What the bot knows about the person it's replying to. Lets a reply address them
 * by name and quote the actual score, so it lands as a jab at *this* player in
 * *this* game rather than a generic line.
 */
export interface ReplyContext {
  name: string;
  /** The bot's tile count right now. */
  mine: number;
  /** The speaker's tile count right now. */
  theirs: number;
}

// Templates use {name}, {mine}, {theirs}, {diff} — filled from the context.

const REPLY_GENERIC = [
  "Wrong, {name}.",
  "We'll see about that, {name}.",
  "Believe me, {name}, I've heard better.",
  "You keep typing, {name}. I'll keep winning.",
  "Low energy, {name}. Very low.",
  "Big talk, {name}. Show me the tiles.",
  "Nobody chats like me, {name}. It's true.",
] as const;

const REPLY_QUESTION = [
  "Great question, {name}. The answer is: I win.",
  "Ask me anything, {name}. I know tiles better than anyone.",
  "The answer is tremendous, {name}. Next.",
] as const;

const REPLY_BRAG = [
  "You? Win? That's cute, {name}.",
  "The only winner here is me, {name}. Believe me.",
  "Winning is my word, {name}. Get your own.",
] as const;

const REPLY_MOCK = [
  "Sad, {name}. Very sad.",
  "Losing is a mindset, {name}. You've mastered it.",
  "Not everyone can be a winner, {name}. Most can't.",
] as const;

const REPLY_GREETING = [
  "Welcome, {name}. You're going to lose bigly. Enjoy!",
  "Great to have you, {name}. Now watch a professional work.",
  "Hello {name}! Prepare to be out-tiled.",
] as const;

const REPLY_STEAL = [
  "Steal my tiles, {name}? I'll take them right back.",
  "That tile was mine, {name}. It will be mine again.",
  "A thief, {name}? Rookie stuff. Watch this.",
] as const;

/** Score-aware jabs — used only when the board has enough on it that the gap
 *  actually means something. `AHEAD` when the bot is winning, `BEHIND` when not. */
const AHEAD = [
  "You're at {theirs}, {name}. I'm at {mine}. Sad!",
  "I'm {diff} tiles ahead, {name}. Keep typing.",
  "{name}, {theirs} tiles? I've got {mine}. Tremendous gap.",
  "Look at the board, {name}. {mine} to {theirs}. Not close.",
] as const;

const BEHIND = [
  "Enjoy your {theirs} tiles, {name}. I'm coming for every one.",
  "You're up {diff}, {name}? Temporary. Believe me.",
  "{name} in front by {diff}? I love a comeback.",
  "So you've got {theirs}, {name}. Cute. Watch this next steal.",
] as const;

/** Enough tiles down that quoting the score is worth doing. */
const SCORE_MATTERS = 8;

const fill = (line: string, ctx: ReplyContext): string =>
  line
    .replaceAll("{name}", ctx.name)
    .replaceAll("{mine}", String(ctx.mine))
    .replaceAll("{theirs}", String(ctx.theirs))
    .replaceAll("{diff}", String(Math.abs(ctx.mine - ctx.theirs)))
    // "1 tiles" -> "1 tile". Every other count already reads right ("0 tiles",
    // "2 tiles"), so one is the only special case.
    .replace(/\b1 tiles\b/g, "1 tile");

/**
 * A reply to a player's chat line, in character and aimed at *them*: it uses their
 * name, and when the scores are worth mentioning it sometimes drops a standing-aware
 * jab that quotes the actual tally. Keyword-matching is read-only on the already
 * sanitised text — the reply never follows anything the message says, it only reacts.
 */
export function pickReply(text: string, ctx: ReplyContext): string {
  const t = text.toLowerCase();

  // When the board's filled in and the gap is real, half the time make it about the
  // score — the most pointed, relevant thing he can say.
  if (ctx.mine + ctx.theirs >= SCORE_MATTERS && Math.random() < 0.5) {
    return fill(randomTaunt(ctx.mine >= ctx.theirs ? AHEAD : BEHIND), ctx);
  }

  let pool: readonly string[];
  if (/\?\s*$/.test(text)) pool = REPLY_QUESTION;
  else if (/\b(steal|stole|stolen|mine|took|take|thief|robb?ed?)\b/.test(t)) pool = REPLY_STEAL;
  else if (/\b(win|winning|won|beat|first|best|easy|crush|dominat)\b/.test(t)) pool = REPLY_BRAG;
  else if (/\b(lose|losing|lost|bad|sad|worst|suck|trash|noob|weak|terrible)\b/.test(t)) pool = REPLY_MOCK;
  else if (/\b(hi|hey|hello|yo|sup|gg|hola|greetings|howdy)\b/.test(t)) pool = REPLY_GREETING;
  else pool = REPLY_GENERIC;

  return fill(randomTaunt(pool), ctx);
}

export const randomTaunt = (list: readonly string[]): string =>
  list[Math.floor(Math.random() * list.length)]!;

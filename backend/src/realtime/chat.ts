import { CHAT_CHANNEL, subscriber } from "../db/redis";
import type { ChatLine } from "@tessera/shared/domain";
import * as bot from "../services/bot.service";
import { broadcastChat } from "./broadcaster";

/**
 * The realtime end of the chat channel.
 *
 * Chat is published cluster-wide by the handler; this is where each instance turns
 * a published line into something its own connected clients see, and where it
 * keeps a short recent-history buffer so a joiner has context. Mirrors control.ts:
 * every instance runs it and reacts identically, so the instance that received the
 * message is not special — it hears its own line back on the same channel.
 *
 * The buffer is per-instance and rebuilt from the stream, so instances converge on
 * the same recent history; a freshly booted one simply starts empty, which is fine
 * — history is a courtesy, not a guarantee.
 */

const MAX_HISTORY = 30;
const recent: ChatLine[] = [];

/** Recent lines, oldest first — sent to a client once, on join. */
export function history(): ChatLine[] {
  return recent;
}

function ingest(raw: string): void {
  let line: ChatLine;
  try {
    line = JSON.parse(raw) as ChatLine;
  } catch {
    return;
  }
  recent.push(line);
  if (recent.length > MAX_HISTORY) recent.shift();
  broadcastChat(line);
  // The bot is in the room too — let it hear the line and maybe fire back.
  bot.onChatLine(line);
}

/** Subscribe to the chat channel. Called once at boot, after the board is ready. */
export async function start(): Promise<void> {
  subscriber.on("message", (channel: string, raw: string) => {
    if (channel === CHAT_CHANNEL) ingest(raw);
  });
  await subscriber.subscribe(CHAT_CHANNEL);
}

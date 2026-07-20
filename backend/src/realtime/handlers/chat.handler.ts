import type { ChatMsg } from "@tessera/shared/protocol";
import type { ChatLine } from "@tessera/shared/domain";
import { CHAT_CHANNEL, redis } from "../../db/redis";
import { maskProfanity, sanitizeChat } from "../../domain/chat";
import { toPublic } from "../broadcaster";
import type { Connection } from "../connection";

/** Least time between two accepted lines from one socket. Generous — a person
 *  typing never hits it; it only blunts a script hammering the input. The process
 *  guard (rateLimit middleware) still bounds an outright flood underneath. */
const CHAT_MIN_GAP_MS = 400;

/**
 * A player said something.
 *
 * The text is hostile until proven otherwise: sanitised, length-capped and
 * profanity-masked before it can reach anyone. Then it's published on the chat
 * channel rather than sent straight to local sockets, so every instance relays it
 * to its own clients — the sender included, which is what confirms their own line
 * (there is no optimistic echo). A too-soon or empty line is dropped in silence.
 */
export function handleChat(conn: Connection, msg: ChatMsg): void {
  const now = Date.now();
  if (now - conn.lastChatAt < CHAT_MIN_GAP_MS) return;

  const text = maskProfanity(sanitizeChat(msg.text));
  if (text.length === 0) return;

  conn.lastChatAt = now;

  const line: ChatLine = { from: toPublic(conn.player), text, at: now };
  void redis.publish(CHAT_CHANNEL, JSON.stringify(line));
}

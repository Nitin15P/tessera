import Redis from "ioredis";
import { env } from "../../config/env";
import { CLAIM_LUA, OPEN_CHALLENGE_LUA, READ_SNAPSHOT_LUA } from "./scripts";

/**
 * Redis connections and script registration.
 *
 * Two connections, not one: a client in subscriber mode cannot run commands, so
 * pub/sub needs its own. This is the single most common ioredis surprise and the
 * reason it's stated here rather than discovered later.
 */

const options = {
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => Math.min(times * 200, 2000),
};

export const redis = new Redis(env.redisUrl, options);
export const subscriber = new Redis(env.redisUrl, options);

redis.on("error", (e) => console.error("[redis] ", e.message));
subscriber.on("error", (e) => console.error("[redis:sub] ", e.message));

/**
 * ioredis loads these once (SCRIPT LOAD) and then calls them by SHA, so the Lua
 * source isn't re-sent on every claim.
 */
redis.defineCommand("claimCell", { numberOfKeys: 5, lua: CLAIM_LUA });
redis.defineCommand("openChallenge", { numberOfKeys: 3, lua: OPEN_CHALLENGE_LUA });
redis.defineCommand("readSnapshot", { numberOfKeys: 2, lua: READ_SNAPSHOT_LUA });

export type LuaResult = [status: string, ...rest: (string | number)[]];

/**
 * defineCommand attaches methods dynamically, so TypeScript can't see them. The
 * cast is contained to this one declaration; repositories consume a typed shape
 * and never touch `any`.
 */
export const scripts = redis as unknown as {
  claimCell(...args: (string | number)[]): Promise<LuaResult>;
  openChallenge(...args: (string | number)[]): Promise<LuaResult>;
  readSnapshot(...args: string[]): Promise<[string, string[]]>;
};

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), subscriber.quit()]);
}

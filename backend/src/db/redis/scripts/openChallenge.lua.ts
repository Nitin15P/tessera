import { BUCKET_PRELUDE } from "./bucket.lua";

/**
 * Issue a challenge for an owned tile.
 *
 * Scripted rather than run as loose commands so the charge check and the
 * challenge write can't interleave — otherwise a player could spam-open
 * challenges while empty and have them all waiting the moment a charge landed.
 *
 * It *peeks* at the bucket rather than spending: opening a challenge costs
 * nothing, solving it does. Otherwise abandoning a tray — or being too slow —
 * would cost a charge for a tile you never took, which is the same "punished for
 * losing" mistake the claim script is careful to avoid.
 *
 * It records the tile's *current owner* alongside the challenge. The solve
 * script compares against it: a steal only lands if the tile is still owned by
 * whoever it was when this challenge was issued. That's what makes the first
 * solver win and a slower one lose the race rather than overwrite the winner.
 *
 * Note what this deliberately does *not* do: lock the tile. Several players may
 * hold challenges on the same tile at once, and the first correct solve to reach
 * Redis wins. A lock would need expiry timers, and a lock's expiry is itself
 * shared state that can race — trading a solved problem for an unsolved one. The
 * owner check above gives the same "first solver wins" result without a lock.
 *
 * KEYS: 1=grid  2=bk:{playerId}  3=ch:{playerId}
 * ARGV: 1=cell  2=playerIdx  3=answer  4=challengeTtlMs  5=bucketMax  6=refillMs
 *
 * -> {'ok', currentOwner, charges, nextChargeMs}
 *    {'err', reason, charges, nextChargeMs}
 */
export const OPEN_CHALLENGE_LUA =
  BUCKET_PRELUDE +
  `
local gridKey = KEYS[1]
local bkKey   = KEYS[2]
local chKey   = KEYS[3]

local cell       = ARGV[1]
local playerIdx  = tonumber(ARGV[2])
local answer     = ARGV[3]
local chTtlMs    = tonumber(ARGV[4])
local maxCharges = tonumber(ARGV[5])
local refillMs   = tonumber(ARGV[6])

local charges, last, nowMs = bucketPeek(bkKey, maxCharges, refillMs)
local nextMs = bucketNextMs(charges, last, nowMs, maxCharges, refillMs)

local current = tonumber(redis.call('HGET', gridKey, cell)) or 0

if current == 0 then
  -- Free land needs no challenge; the client should have sent 'claim'.
  return {'err', 'bad_cell', charges, nextMs}
end
if current == playerIdx then
  return {'err', 'own_cell', charges, nextMs}
end
if charges < 1 then
  return {'err', 'no_charges', charges, nextMs}
end

-- One outstanding challenge per player: the key is per-player, so opening a new
-- one silently abandons the old. That is intended — clicking a different tile
-- should not leave a live challenge behind you.
redis.call('DEL', chKey)
-- 'owner' is the compare-and-swap witness the solve script checks against.
redis.call('HSET', chKey, 'cell', cell, 'answer', answer, 'owner', current)
redis.call('PEXPIRE', chKey, chTtlMs)

return {'ok', current, charges, nextMs}
`;

/**
 * The token bucket, as a Lua prelude shared by every script that needs it.
 *
 * Two scripts care about a player's charges — claiming spends one, opening a
 * challenge checks there is one to spend — and the refill arithmetic is fiddly
 * enough that writing it twice would be writing it two different ways. Redis has
 * no `require`, so the prelude is concatenated into each script at load time.
 * Same source, one definition, no drift.
 *
 * Two details that are easy to get wrong and expensive to debug:
 *
 *  1. **`last` advances by whole refill periods, not to `now`.** Snapping it to
 *     now would silently discard the fraction of a period already elapsed, so a
 *     player clicking steadily would refill slower than advertised — a drift
 *     nobody would ever trace back to one line of Lua.
 *
 *  2. **A full bucket does not accrue credit.** Once at max, `last` is pinned to
 *     now; otherwise an idle player would bank hours of elapsed time and then
 *     fire hundreds of claims in one burst, which is precisely the thing the
 *     bucket exists to prevent.
 *
 * Time comes from `redis.call('TIME')`, not from the client and not from the
 * Node process. The clock has to be the same one for every instance, or two
 * backends behind a load balancer would enforce subtly different rules — and
 * with effect-based replication (Redis 5+) calling TIME inside a script is fine.
 */
export const BUCKET_PRELUDE = `
local function bucketNowMs()
  local t = redis.call('TIME')
  return tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
end

-- Reads the bucket and applies any refill owed, without spending anything.
-- Returns: charges, last, nowMs
local function bucketPeek(key, maxCharges, refillMs)
  local nowMs = bucketNowMs()
  local charges = tonumber(redis.call('HGET', key, 'c'))
  local last = tonumber(redis.call('HGET', key, 't'))

  -- No bucket (new player, or it expired while idle) means a full one. Expiry is
  -- set to the full refill time, so anything that lapsed would be full anyway.
  if charges == nil or last == nil then
    return maxCharges, nowMs, nowMs
  end

  local gained = math.floor((nowMs - last) / refillMs)
  if gained > 0 then
    charges = math.min(maxCharges, charges + gained)
    -- Whole periods only: keep the remainder rather than discarding it.
    last = last + gained * refillMs
  end

  if charges >= maxCharges then
    charges = maxCharges
    last = nowMs  -- a full bucket banks nothing
  end

  return charges, last, nowMs
end

-- ms until the next charge lands; 0 when already full.
local function bucketNextMs(charges, last, nowMs, maxCharges, refillMs)
  if charges >= maxCharges then return 0 end
  local due = last + refillMs - nowMs
  if due < 0 then return 0 end
  return due
end

local function bucketWrite(key, charges, last, ttlMs)
  redis.call('HSET', key, 'c', charges, 't', last)
  redis.call('PEXPIRE', key, ttlMs)
end
`;

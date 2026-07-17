import { BUCKET_PRELUDE } from "./bucket.lua";

/**
 * The claim. This is the answer to the whole assignment; everything else is
 * plumbing around it.
 *
 * The race being killed: two players click the same tile 10ms apart. A naive
 * handler reads the tile (unclaimed), decides the claim is valid, then writes.
 * Interleave two of those and both read "unclaimed" before either writes — both
 * are told they won, and their two browsers disagree forever, with nothing
 * crashing and no error to notice.
 *
 * Redis runs a script to completion before any other command from any other
 * client, so the read and the write cannot be prised apart. There is no window.
 *
 * Why not Node's single-threaded event loop instead? A handler with no `await`
 * can't be interrupted, which is a real guarantee — but it only holds for one
 * process. The moment a second instance exists behind a load balancer (which
 * "deployed" implies) it evaporates silently. Atomicity belongs where the state
 * is. `backend/test/crossInstance.test.ts` is the proof.
 *
 * Note that the bucket rides inside the same script. It isn't a separate check
 * bolted in front — spending a charge and writing the tile are the same
 * indivisible operation, so a claim can never succeed while failing to charge
 * for it, or charge without succeeding.
 *
 * Inlined as a string rather than kept as a .lua file so dev (tsx) and prod
 * (esbuild bundle) load it identically, with no loader config and no runtime
 * file resolution that breaks once bundled.
 *
 * KEYS: 1=grid  2=seq  3=bk:{playerId}  4=ch:{playerId}  5=leaderboard
 * ARGV: 1=cell  2=playerIdx  3=mode('claim'|'solve')  4=answer  5=channel
 *       6=bucketMax  7=refillMs  8=bucketTtlMs
 *
 * Every path returns the same five slots:
 *   {status, seqOrReason, prevOwner, charges, nextChargeMs}
 *
 * Uniform arity on purpose. An earlier version returned four on the error path
 * and five on success, which meant the caller's destructuring silently shifted
 * — `charges` landed in the `nextChargeMs` slot and still "worked", because both
 * are numbers. Nothing would have caught that except reading it very carefully.
 * prevOwner is -1 when there isn't one.
 */
export const CLAIM_LUA =
  BUCKET_PRELUDE +
  `
local gridKey = KEYS[1]
local seqKey  = KEYS[2]
local bkKey   = KEYS[3]
local chKey   = KEYS[4]
local lbKey   = KEYS[5]

local cell       = ARGV[1]
local playerIdx  = tonumber(ARGV[2])
local mode       = ARGV[3]
local answer     = ARGV[4]
local channel    = ARGV[5]
local maxCharges = tonumber(ARGV[6])
local refillMs   = tonumber(ARGV[7])
local ttlMs      = tonumber(ARGV[8])

local charges, last, nowMs = bucketPeek(bkKey, maxCharges, refillMs)
local nextMs = bucketNextMs(charges, last, nowMs, maxCharges, refillMs)

-- HGET returns false when the field is absent; tonumber(false) is nil.
local current = tonumber(redis.call('HGET', gridKey, cell)) or 0

if current == playerIdx then
  return {'err', 'own_cell', -1, charges, nextMs}
end

-- Charges are *checked* here but only *spent* on success, so a rejected click
-- never costs you one — losing a race is punishment enough. Checking and
-- spending separately would be a race anywhere else; inside this script nothing
-- can run between the two.
if charges < 1 then
  return {'err', 'no_charges', -1, charges, nextMs}
end

if mode == 'claim' then
  -- Free land only. Owned land must go through a challenge.
  if current ~= 0 then
    return {'err', 'taken', -1, charges, nextMs}
  end
else
  -- A steal. The challenge must exist, be for this exact tile, and be right.
  -- The answer never left the server, so a client cannot manufacture this.
  local chCell = redis.call('HGET', chKey, 'cell')
  if not chCell or chCell ~= cell then
    return {'err', 'no_challenge', -1, charges, nextMs}
  end
  if redis.call('HGET', chKey, 'answer') ~= answer then
    -- A wrong answer does NOT consume the challenge: it's probably a mis-click,
    -- and letting them try again within the TTL is the kind thing to do.
    return {'err', 'wrong', -1, charges, nextMs}
  end

  -- A correct answer always consumes the challenge, so it can never be replayed.
  local expectedOwner = tonumber(redis.call('HGET', chKey, 'owner'))
  redis.call('DEL', chKey)

  -- Compare-and-swap on the owner. This is the whole point of the change: a steal
  -- succeeds only if the tile is still owned by whoever it was when the challenge
  -- was issued. If someone else solved faster and took it in the meantime, the
  -- owner has moved, and *they* win — the slower solver is rejected here.
  --
  -- This makes a steal symmetric with claiming free land: free land is "write me
  -- only if still unclaimed", a steal is "write me only if still owned by the
  -- player I challenged". Both are first-to-commit-wins; last-write-wins was the
  -- odd one out, and rewarded solving slowly, which is backwards.
  --
  -- The charge is NOT spent on this path: they solved it honestly and only lost
  -- the race, so it would be a double punishment. Note the benign ABA case — if
  -- the tile went A -> B -> A while you solved, expectedOwner matches again and
  -- you take it from A, which is exactly who you set out to take it from, so the
  -- outcome is still coherent.
  if current ~= expectedOwner then
    return {'err', 'taken', -1, charges, nextMs}
  end
end

redis.call('HSET', gridKey, cell, playerIdx)
local seq = redis.call('INCR', seqKey)

-- Scores move inside the same atomic unit as the tile, so the leaderboard
-- cannot drift from the board. If they ever disagreed it would mean the claim
-- itself was broken.
redis.call('ZINCRBY', lbKey, 1, playerIdx)
if current ~= 0 then
  -- A steal: the previous owner loses one. If that was their last tile, drop
  -- them from the leaderboard entirely rather than leaving a zombie at score 0,
  -- so the ZSet is bounded by *current* owners, not everyone who ever played.
  local prev = tonumber(redis.call('ZINCRBY', lbKey, -1, current))
  if prev <= 0 then
    redis.call('ZREM', lbKey, current)
  end
end

-- Spend. A bucket that was full starts refilling from now.
if charges >= maxCharges then last = nowMs end
charges = charges - 1
bucketWrite(bkKey, charges, last, ttlMs)
nextMs = bucketNextMs(charges, last, nowMs, maxCharges, refillMs)

-- Published inside the script, so fan-out cannot be ordered differently from the
-- write that caused it. Every backend instance receives this.
redis.call('PUBLISH', channel, seq .. ':' .. cell .. ':' .. playerIdx .. ':' .. current)

return {'ok', seq, current, charges, nextMs}
`;

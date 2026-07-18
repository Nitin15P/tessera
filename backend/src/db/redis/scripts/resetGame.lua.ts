/**
 * End the current race: wipe the board and the leaderboard, then announce it.
 *
 * Atomic on purpose. Clearing the grid and the scores in one indivisible unit
 * means no client can ever read a half-reset world — an empty board still
 * carrying yesterday's standings, or standings for tiles that no longer exist.
 *
 * `seq` is bumped *forward* (INCR), never reset to zero. Lowering it would trip
 * every other instance's "Redis was flushed" self-heal and be logged as an
 * incident; keeping it monotonic means the reset is an ordinary forward step,
 * and instances learn about it through the intentional control channel instead.
 *
 * The lock makes the reset idempotent: the pathological case where two players
 * both cross the target within the same millisecond would otherwise fire two
 * resets. SET NX wins for exactly one of them; the loser no-ops and returns 0.
 *
 * KEYS: 1=grid  2=leaderboard  3=seq  4=resetLock
 * ARGV: 1=controlChannel  2=lockTtlMs
 * -> the new seq, or 0 if another reset already claimed this race
 */
export const RESET_GAME_LUA = `
if not redis.call('SET', KEYS[4], '1', 'NX', 'PX', tonumber(ARGV[2])) then
  return 0
end

redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
local seq = redis.call('INCR', KEYS[3])

redis.call('PUBLISH', ARGV[1], 'roundReset:' .. seq)
return seq
`;

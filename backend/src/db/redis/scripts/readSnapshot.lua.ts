/**
 * Read the grid and the sequence number as one atomic pair.
 *
 * Reading them separately would reintroduce the exact bug this design exists to
 * avoid: a write landing between the two gives a grid stamped with a sequence it
 * doesn't match, and every gap check downstream is then quietly lying.
 *
 * KEYS: 1=grid  2=seq
 * -> {seq, [field, value, field, value, ...]}
 */
export const READ_SNAPSHOT_LUA = `
return { redis.call('GET', KEYS[2]) or '0', redis.call('HGETALL', KEYS[1]) }
`;

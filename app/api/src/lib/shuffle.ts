/**
 * Seeded deterministic shuffle and subset selection.
 *
 * The same seed always produces the same ordering and the same subset, which is
 * what guarantees a stable manifest across resume, including resume on a
 * different device. Ordering is purely presentational; integrity always relies
 * on stable IDs, never on display position.
 */

/**
 * Mulberry32 pseudo-random generator. Small, fast, and fully deterministic for a
 * given 32-bit seed. Returns a function that yields floats in the range [0, 1).
 */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert an arbitrary string seed into a stable 32-bit integer (FNV-1a style).
 * This lets us accept a UUID-derived seed string while still feeding a numeric
 * generator.
 */
export function seedFromString(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Return a new array shuffled deterministically using a Fisher-Yates pass driven
 * by the seed. The input array is not mutated.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rng = createRng(seedFromString(seed));
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

/**
 * Deterministically select a subset of the given size from the items, ordered by
 * the seed. If the requested count is greater than or equal to the available
 * items, the full set is returned in shuffled order.
 */
export function seededSubset<T>(items: readonly T[], count: number, seed: string): T[] {
  const shuffled = seededShuffle(items, seed);
  if (count >= shuffled.length) {
    return shuffled;
  }
  return shuffled.slice(0, count);
}

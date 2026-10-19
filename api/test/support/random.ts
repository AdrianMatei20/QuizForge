import type { Random } from '../../src/quiz/shuffle.js';

/**
 * mulberry32: a tiny seeded generator with values in [0, 1). Same seed, same
 * sequence, so tests that shuffle options are reproducible.
 */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The seed every test that shuffles uses, unless it needs several. */
export const TEST_SEED = 42;

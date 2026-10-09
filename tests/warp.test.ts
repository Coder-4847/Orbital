import { describe, expect, it } from 'vitest';
import { MAX_FLIGHT_WARP_INDEX, MAX_WARP_INDEX, WARP_RATES, clampWarpIndex, formatWarp, stepWarp } from '../src/core/warp';

describe('time warp ladder', () => {
  it('matches the spec rates up to 100,000x in flight', () => {
    expect(WARP_RATES.slice(0, MAX_FLIGHT_WARP_INDEX + 1)).toEqual([1, 5, 10, 50, 100, 1000, 10_000, 100_000]);
    expect(WARP_RATES[MAX_WARP_INDEX]).toBeGreaterThan(100_000);
  });
  it('steps and clamps', () => {
    expect(stepWarp(0, -1, 7)).toBe(0);
    expect(stepWarp(7, 1, 7)).toBe(7);
    expect(stepWarp(3, 1, 7)).toBe(4);
    expect(clampWarpIndex(99, 5)).toBe(5);
  });
  it('formats with separators', () => {
    expect(formatWarp(100_000)).toBe('×100,000');
  });
});

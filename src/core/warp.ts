/** Time-warp ladder. Universal time advances by dt * rate, so any warp (and any jump) is exact: bodies are analytic in UT. */
export const WARP_RATES = [1, 5, 10, 50, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000] as const;

/** Highest rate allowed in normal flight (the spec's 100,000x); the map view and the cheat menu unlock the rest. */
export const MAX_FLIGHT_WARP_INDEX = 7;
export const MAX_WARP_INDEX = WARP_RATES.length - 1;

export const clampWarpIndex = (i: number, max: number): number => Math.max(0, Math.min(max, i));

export function formatWarp(rate: number): string {
  return `×${rate.toLocaleString('en-US')}`;
}

/** Step the warp index up or down, respecting the current ceiling. */
export const stepWarp = (index: number, direction: 1 | -1, max: number): number => clampWarpIndex(index + direction, max);

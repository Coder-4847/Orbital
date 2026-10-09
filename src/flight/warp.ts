/**
 * Time warp. One ladder of rates: the first few are physics warp (the vessel is still simulated, just faster), the rest are
 * rails warp (the vessel follows its orbit analytically and nothing else is simulated). Rails needs an orbit clear of air and
 * ground, so the controller refuses it otherwise, and "warp to" slows down in good time and stops on arrival. Pure logic.
 */
export const WARP_RATES = [1, 2, 3, 4, 10, 50, 100, 1_000, 10_000, 100_000] as const;
/** Rates up to and including this index are physics warp. */
export const MAX_PHYSICS_INDEX = 3;

export const isRails = (index: number): boolean => index > MAX_PHYSICS_INDEX;

export class Warp {
  index = 0;
  /** Universal time to warp to, or null. */
  target: number | null = null;

  get rate(): number {
    return WARP_RATES[this.index]!;
  }

  get rails(): boolean {
    return isRails(this.index);
  }

  /** Step the ladder. `blocker` is why rails is unavailable (or null). Returns a message if a request was refused. */
  change(delta: number, blocker: string | null): string | null {
    this.target = null;
    let next = Math.max(0, Math.min(WARP_RATES.length - 1, this.index + delta));
    let message: string | null = null;
    if (blocker && isRails(next)) {
      next = Math.min(next, MAX_PHYSICS_INDEX);
      if (delta > 0) message = `Cannot time warp: ${blocker.toLowerCase()}.`;
    }
    this.index = next;
    return message;
  }

  reset(): void {
    this.index = 0;
    this.target = null;
  }

  /** Warp to universal time `ut`: speeds up as far as is useful and slows to real time on arrival. */
  warpTo(ut: number): void {
    this.target = ut;
  }

  /**
   * Called every frame. Applies a pending "warp to" (choosing the fastest rate that leaves a few seconds of real time to the
   * target) and drops out of rails if it has become unsafe. Returns the number of simulated seconds this frame must cover at most
   * (Infinity when there is no target), so the caller can land exactly on the target.
   */
  update(ut: number, blocker: string | null): number {
    if (this.rails && blocker) this.index = MAX_PHYSICS_INDEX;
    if (this.target === null) return Infinity;
    const remaining = this.target - ut;
    if (remaining <= 0.01) {
      this.reset();
      return 0;
    }
    let best = 0;
    for (let i = 0; i < WARP_RATES.length; i++) {
      if (isRails(i) && blocker) break;
      if (WARP_RATES[i]! * 3 <= remaining) best = i;
    }
    this.index = best;
    return remaining;
  }
}

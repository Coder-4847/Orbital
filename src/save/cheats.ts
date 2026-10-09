/**
 * The cheats menu's switches. Cheats are for fun and sandboxing: they are off by default, remembered between sessions, and
 * never change a save file. `toFlags` turns the player's choices into what the flight physics reads.
 */
import { Store } from '../core/store';
import type { CheatFlags } from '../flight/flight-world';

export interface Cheats {
  unlimitedFuel: boolean;
  unlimitedCharge: boolean;
  /** Hangar: no part-count, size or mass limits. Mirrors the key the Hangar editor has always used. */
  unlimitedBuild: boolean;
  unlockAllParts: boolean;
  /** Engines deliver `MAX_THRUST_MULTIPLIER` times their thrust. */
  maxThrust: boolean;
  invulnerable: boolean;
  noHeating: boolean;
  noAero: boolean;
  zeroGravity: boolean;
  maxWarp: boolean;
  debugOverlay: boolean;
}

export const CHEATS_KEY = 'orbital.cheats';
/** The Hangar editor reads and writes this key itself; the store keeps it in step. */
export const LEGACY_UNLIMITED_KEY = 'orbital.cheat.unlimitedBuild';
export const MAX_THRUST_MULTIPLIER = 4;

export const NO_CHEAT_SWITCHES: Cheats = {
  unlimitedFuel: false,
  unlimitedCharge: false,
  unlimitedBuild: false,
  unlockAllParts: true,
  maxThrust: false,
  invulnerable: false,
  noHeating: false,
  noAero: false,
  zeroGravity: false,
  maxWarp: false,
  debugOverlay: false,
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Only keys that exist, with boolean values, survive loading. */
export function parseCheats(raw: unknown): Cheats {
  const out = { ...NO_CHEAT_SWITCHES };
  if (typeof raw === 'object' && raw !== null) {
    for (const key of Object.keys(out) as Array<keyof Cheats>) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === 'boolean') out[key] = v;
    }
  }
  return out;
}

export const toFlags = (c: Cheats): CheatFlags => ({
  unlimitedFuel: c.unlimitedFuel,
  unlimitedCharge: c.unlimitedCharge,
  thrustMultiplier: c.maxThrust ? MAX_THRUST_MULTIPLIER : 1,
  invulnerable: c.invulnerable,
  noHeating: c.noHeating,
  noAero: c.noAero,
  zeroGravity: c.zeroGravity,
  maxWarp: c.maxWarp,
});

export class CheatStore extends Store<Cheats> {
  constructor(private storage: StorageLike | null = safeStorage()) {
    super(CheatStore.load(storage));
  }

  private static load(storage: StorageLike | null): Cheats {
    let cheats = NO_CHEAT_SWITCHES;
    try {
      const text = storage?.getItem(CHEATS_KEY);
      cheats = parseCheats(text ? JSON.parse(text) : null);
      if (storage?.getItem(LEGACY_UNLIMITED_KEY) === '1') cheats = { ...cheats, unlimitedBuild: true };
    } catch {
      /* unreadable: start clean */
    }
    return { ...cheats };
  }

  /** Switch one cheat on or off. */
  setCheat<K extends keyof Cheats>(key: K, value: Cheats[K]): void {
    this.update((c) => ({ ...c, [key]: value }));
  }

  /** Is any gameplay cheat on? (The flight HUD says so, to remind the player.) */
  get anyActive(): boolean {
    const c = this.state;
    return c.unlimitedFuel || c.unlimitedCharge || c.maxThrust || c.invulnerable || c.noHeating || c.noAero || c.zeroGravity || c.maxWarp;
  }

  reset(): void {
    this.set({ ...NO_CHEAT_SWITCHES });
  }

  override set(next: Cheats): void {
    super.set(next);
    try {
      this.storage?.setItem(CHEATS_KEY, JSON.stringify(next));
      this.storage?.setItem(LEGACY_UNLIMITED_KEY, next.unlimitedBuild ? '1' : '0');
    } catch {
      /* not persisted */
    }
  }
}

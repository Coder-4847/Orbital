/** Connects the cheats menu to the running flight: the physics switches and the one-shot actions. */
import type { AppContext } from '../core/scene-manager';
import { DEFAULT_SITE } from '../data/sites';
import type { CheatFlags, FlightWorld } from '../flight/flight-world';
import type { Navigator } from '../flight/navigator';
import { jumpToTime, teleportToOrbit, teleportToSurface } from '../flight/relocate';
import { toFlags } from '../save/cheats';
import type { FlightCheatActions } from '../ui/cheats/cheats-panel';

/** The physics switches for the current cheats, with the "auto-warp safety" setting folded in. */
export function currentFlags(ctx: AppContext): CheatFlags {
  const flags = toFlags(ctx.cheats.get());
  if (!ctx.settings.get().gameplay.autoWarpSafety) flags.maxWarp = true;
  return flags;
}

export interface CheatHost {
  ctx: AppContext;
  world(): FlightWorld;
  nav(): Navigator;
  /** The vessel was moved: reset what depends on where it is. `onPad` selects the pad camera. */
  moved(onPad: boolean): void;
}

export function cheatActions(h: CheatHost): FlightCheatActions {
  const done = (error: string | null, onPad = false): string | null => {
    if (!error) h.moved(onPad);
    return error;
  };
  return {
    refuelAndRepair: () => h.world().refuelAndRepair(),
    teleportToOrbit: (body, altitude) => done(teleportToOrbit(h.world(), body, altitude)),
    teleportToSurface: (body, lat, lon) => done(teleportToSurface(h.world(), body, lat, lon)),
    teleportToPad: () => done(teleportToSurface(h.world(), 'earth', DEFAULT_SITE.lat, DEFAULT_SITE.lon), true),
    currentUT: () => h.world().ut,
    jumpToTime: (ut) => done(jumpToTime(h.world(), h.nav(), ut)),
  };
}

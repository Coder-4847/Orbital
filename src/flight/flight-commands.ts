/** Applying the player's discrete commands to the active vessel, and gathering what the HUD shows. */
import { universalTimeToDate } from '../core/time';
import { bodyDef } from '../data/solar-system';
import { altitudeOf, surfaceVelocity } from './env';
import type { FlightWorld } from './flight-world';
import { armChutes } from './flight-ops';
import type { Command } from './flight-input';
import type { HudState } from './hud';
import { vdot, vsub, type V3 } from './math3';
import { orbitInfo } from './orbit-info';
import { flightVectors } from './sas';
import type { SasMode, Vessel } from './vessel';

const SAS_ORDER: SasMode[] = ['stability', 'prograde', 'retrograde', 'normal', 'antinormal', 'radialOut', 'radialIn', 'maneuver'];

/** Apply one command. Returns a message for the HUD, if there is something to say. */
export function applyCommand(world: FlightWorld, v: Vessel, cmd: Command): string | null {
  switch (cmd) {
    case 'stage': {
      const n = world.stage(v);
      return n < 0 ? 'No more stages.' : null; // activation messages come from the vessel's own log
    }
    case 'sas':
      v.sas.enabled = !v.sas.enabled;
      v.sas.hold = null;
      return `SAS ${v.sas.enabled ? 'on' : 'off'}`;
    case 'sasMode':
    case 'sasModeBack': {
      const i = SAS_ORDER.indexOf(v.sas.mode);
      v.sas.mode = SAS_ORDER[(i + (cmd === 'sasMode' ? 1 : SAS_ORDER.length - 1)) % SAS_ORDER.length]!;
      v.sas.enabled = true;
      v.sas.hold = null;
      return `SAS: ${v.sas.mode}`;
    }
    case 'rcs':
      v.rcs = !v.rcs;
      return `RCS ${v.rcs ? 'on' : 'off'}`;
    case 'gear': {
      if (!v.parts.some((p) => p.def.look === 'leg')) return 'No landing legs.';
      v.legsOut = !v.legsOut;
      return `Landing legs ${v.legsOut ? 'extending' : 'retracting'}`;
    }
    case 'brakes':
      v.brakes = !v.brakes;
      return `Brakes ${v.brakes ? 'on' : 'off'}`;
    case 'chutes':
      if (!v.parts.some((p) => p.def.category === 'parachute')) return 'No parachutes.';
      armChutes(v);
      return 'Parachutes armed: they open when the air is thick enough.';
    default:
      return null;
  }
}

/** Set the SAS mode directly (HUD buttons). */
export function setSasMode(v: Vessel, mode: SasMode): void {
  v.sas.mode = mode;
  v.sas.enabled = true;
  v.sas.hold = null;
}

export function hudState(world: FlightWorld, v: Vessel, cameraMode: string, warpText: string, node: HudState['node'], muted: boolean, initialFuel: number, units: HudState['units']): HudState {
  const env = world.env;
  const fv = flightVectors(v, env);
  const orbit = orbitInfo(v.pos, v.vel, env.mu, env.radius, env.spinAxis);
  const altitude = altitudeOf(env, v.pos);
  const ground = env.groundRadius(v.pos) - env.radius;
  const rel: V3 = vsub(v.vel, surfaceVelocity(env, v.pos));
  return {
    vessel: v,
    fv,
    orbit,
    altitude,
    agl: Math.max(0, altitude - ground),
    verticalSpeed: vdot(rel, fv.up),
    warpText,
    bodyName: bodyDef(world.bodyId).name,
    node,
    cameraMode,
    muted,
    totalFuel: v.parts.reduce((s, p) => s + (p.def.propellant?.kind === 'solid' ? 0 : p.fuel), 0),
    initialFuel,
    units,
    date: universalTimeToDate(world.ut).toISOString().slice(0, 19).replace('T', ' '),
  };
}


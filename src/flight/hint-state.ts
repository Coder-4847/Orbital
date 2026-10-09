/** Gathers what the hint rules need to know about the flight (see hints.ts). */
import { atmosphereTop } from './body-env';
import { bodyDef } from '../data/solar-system';
import { altitudeOf, horizon, surfaceVelocity } from './env';
import type { FlightWorld } from './flight-world';
import type { GuideState } from './guide';
import type { HintState } from './hints';
import { qrot, vdot, vlen, vnorm, vsub } from './math3';
import { orbitInfo } from './orbit-info';
import type { Navigator } from './navigator';

export interface HintExtras {
  enabled: boolean;
  seen: ReadonlySet<string>;
  busy: boolean;
  mapOpen: boolean;
  enteredSoi: boolean;
  atRealTime: boolean;
  everLiftedOff: boolean;
}

export function hintState(world: FlightWorld, nav: Navigator, x: HintExtras): HintState | null {
  const v = world.active;
  if (!v) return null;
  const env = world.env;
  const orbit = orbitInfo(v.pos, v.vel, env.mu, env.radius, env.spinAxis);
  const altitude = altitudeOf(env, v.pos);
  const rel = vsub(v.vel, surfaceVelocity(env, v.pos));
  const node = nav.activeNode();
  const eta = node ? node.ut - world.ut : Infinity;
  return {
    enabled: x.enabled,
    seen: x.seen,
    busy: x.busy,
    bodyId: world.bodyId,
    situation: v.situation === 'rest' ? 'rest' : 'flying',
    met: v.met,
    altitude,
    agl: Math.max(0, altitude - (env.groundRadius(v.pos) - env.radius)),
    speed: vlen(rel),
    verticalSpeed: vdot(rel, vnorm(v.pos)),
    apoapsis: orbit.apoapsis,
    periapsis: orbit.periapsis,
    atmosphereTop: atmosphereTop(world.bodyId),
    throttle: v.throttle,
    thrust: v.tele.thrust,
    stageWaiting: v.parts.some((p) => p.stage >= v.nextStage && (p.def.engine || p.def.decoupler)),
    hullHeat: v.tele.heat,
    hasChutes: v.parts.some((p) => p.def.category === 'parachute'),
    chutesArmed: v.parts.some((p) => p.def.category === 'parachute' && p.chute !== 'stowed'),
    hasLegs: v.parts.some((p) => p.def.look === 'leg'),
    legsOut: v.legsOut,
    mapOpen: x.mapOpen,
    hasNode: !!node,
    nodeSoon: eta < 90,
    enteredSoi: x.enteredSoi,
    atRealTime: x.atRealTime,
    everLiftedOff: x.everLiftedOff,
  };
}

/** The hint state plus what the flight guide needs (see guide.ts). */
export function guideState(world: FlightWorld, hint: HintState, reachedOrbit: boolean, fuelLeft: number): GuideState | null {
  const v = world.active;
  if (!v) return null;
  const env = world.env;
  const orbit = orbitInfo(v.pos, v.vel, env.mu, env.radius, env.spinAxis);
  const nose = qrot(v.q, [0, 1, 0]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, vdot(nose, horizon(env, v.pos).up))));
  return { ...hint, pitchDeg: (pitch * 180) / Math.PI, timeToApoapsis: orbit.bound ? orbit.timeToApoapsis : Infinity, reachedOrbit, fuelLeft, bodyName: bodyDef(world.bodyId).name };
}

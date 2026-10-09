/**
 * A scripted pilot for whole missions, using only what a player has: nodes, SAS, throttle, staging, time warp. Each function
 * flies one phase against the real physics and returns when the phase is done (or throws with a useful message).
 */
import { EXAMPLES } from '../../src/builder/examples';
import type { Craft } from '../../src/builder/craft';
import { bodyDef } from '../../src/data/solar-system';
import { bodyFlightEnv, sphereHost } from '../../src/flight/body-env';
import { altitudeOf, horizon, surfaceVelocity } from '../../src/flight/env';
import { FlightWorld } from '../../src/flight/flight-world';
import { burnEstimate, nodeMagnitude, type ManeuverNode } from '../../src/flight/maneuver';
import { clamp, qrot, vadd, vdot, vlen, vnorm, vscale, vsub, type V3 } from '../../src/flight/math3';
import { Navigator } from '../../src/flight/navigator';
import { orbitInfo } from '../../src/flight/orbit-info';
import { closestApproach, predictTrajectory, type NavModel, type Patch } from '../../src/flight/trajectory';
import type { Vessel } from '../../src/flight/vessel';
import { Ephemeris } from '../../src/physics/ephemeris';
import { propagate, type Vec3 } from '../../src/physics/kepler';

export const DT = 1 / 120;

export interface Rig {
  eph: Ephemeris;
  world: FlightWorld;
  nav: Navigator;
  model: NavModel;
  log: string[];
}

export function makeRig(ut = 8.0e8): Rig {
  const eph = new Ephemeris();
  const host = sphereHost(eph);
  const world = new FlightWorld(bodyFlightEnv(host, 'earth'), ut, host);
  const nav = new Navigator(() => world);
  const model: NavModel = { ephemeris: eph, floor: (id) => world.envOf(id).railsFloor ?? 15_000 };
  return { eph, world, nav, model, log: [] };
}

export const moduleCraft = (): Craft => EXAMPLES.find((e) => e.id === 'selene-module')!.build();

/** Start the module in a circular orbit about Earth at `altitude`, nose along the direction of travel. */
export function startInOrbit(rig: Rig, craft: Craft, altitude = 200_000): Vessel {
  const earth = bodyDef('earth');
  const r = earth.radius + altitude;
  return rig.world.spawn(craft, [r, 0, 0], [0, 0, Math.sqrt(earth.gm / r)], [0, 0, 1]);
}

export const note = (rig: Rig, text: string): void => {
  const w = rig.world;
  const v = w.active;
  const orb = v ? orbitInfo(v.pos, v.vel, w.env.mu, w.env.radius) : null;
  rig.log.push(`[ut+${(w.ut - 8.0e8).toFixed(0)}] ${bodyDef(w.bodyId).name}: ${text}${orb ? ` | alt ${(altitudeOf(w.env, v!.pos) / 1000).toFixed(0)} km, ap ${Math.round(orb.apoapsis / 1000)} km, pe ${Math.round(orb.periapsis / 1000)} km` : ''}`);
};

function vessel(rig: Rig): Vessel {
  const v = rig.world.active;
  if (!v) throw new Error(`The vessel was lost (vessel()).\n${rig.log.join('\n')}`);
  return v;
}

/** Physics-step for `seconds`. */
export function run(rig: Rig, seconds: number, each?: (v: Vessel) => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    rig.world.step(DT);
    const v = rig.world.active;
    if (!v) throw new Error(`The vessel was lost (run()).\n${rig.log.join('\n')}\n${[...rig.world.vessels.flatMap((x) => x.log)].join('\n')}`);
    each?.(v);
  }
}

/** Coast to universal time `ut`: rails where possible, physics otherwise. Stops early (returning the reason) at a body change or the floor. */
export function coastTo(rig: Rig, ut: number, maxHop = 3600): 'done' | 'floor' | 'soi' {
  const { world, nav } = rig;
  const v = vessel(rig);
  v.throttle = 0;
  while (world.ut < ut - 1e-6) {
    if (nav.railsBlocker() === null) {
      let r;
      try {
        r = nav.advanceRails(Math.min(maxHop, ut - world.ut), 0);
      } catch (e) {
        rig.log.push('rails threw: ' + String((e as Error).stack));
        throw e;
      }
      if (rig.log.length < 100000 && world.bodyId === 'earth' && (vlen(vessel(rig).pos) - world.env.radius) < 3e8) rig.log.push(`   hop to ${(world.ut - 8e8).toFixed(0)} alt=${((vlen(vessel(rig).pos) - world.env.radius) / 1000).toFixed(0)}km stopped=${r.stopped} floorUt=${nav.trajectory?.patches[0]?.floorUt === null ? 'null' : ((nav.trajectory?.patches[0]?.floorUt ?? 0) - world.ut).toFixed(0)}`);
      if (r.stopped) return 'floor';
      if (r.entered) {
        note(rig, `entered ${r.entered}`);
        return 'soi';
      }
    } else {
      if (rig.log.length < 100000) rig.log.push('   coast blocked: ' + nav.railsBlocker() + ' thrust=' + v.tele.thrust + ' thr=' + v.throttle);
      run(rig, Math.min(5, ut - world.ut));
    }
  }
  return 'done';
}

/** Point at `dir()` with SAS (hold-attitude via the pilot's controls is not needed: SAS modes do it). Returns when within `tol` degrees. */
function aimAlong(rig: Rig, mode: 'maneuver' | 'prograde' | 'retrograde' | 'radialOut' | 'radialIn', tolDeg = 2, maxSeconds = 90): void {
  const v = vessel(rig);
  v.sas.enabled = true;
  v.sas.mode = mode;
  v.sas.hold = null;
  for (let t = 0; t < maxSeconds; t += 0.25) {
    run(rig, 0.25, () => updateManeuverDir(rig, null));
    const target = pointingTarget(rig, mode);
    if (!target) return;
    const nose = qrot(vessel(rig).q, [0, 1, 0]);
    if ((Math.acos(clamp(vdot(nose, target), -1, 1)) * 180) / Math.PI < tolDeg && vlen(vessel(rig).w) < 0.004) return;
  }
}

function pointingTarget(rig: Rig, mode: string): V3 | null {
  const v = vessel(rig);
  const w = rig.world;
  const { up } = horizon(w.env, v.pos);
  const ref = altitudeOf(w.env, v.pos) < 36_000 ? vsub(v.vel, surfaceVelocity(w.env, v.pos)) : v.vel;
  if (mode === 'maneuver') return w.maneuverDir;
  if (mode === 'prograde') return vnorm(ref);
  if (mode === 'retrograde') return vscale(vnorm(ref), -1);
  if (mode === 'radialOut') return up;
  return vscale(up, -1);
}

let lastDirUpdate = -1;
function updateManeuverDir(rig: Rig, node: ManeuverNode | null): void {
  const { world, nav } = rig;
  if (world.ut - lastDirUpdate < 0.2 && lastDirUpdate > 0) return;
  lastDirUpdate = world.ut;
  const n = node ?? nav.activeNode();
  if (!n) {
    world.maneuverDir = null;
    return;
  }
  nav.refresh(0, 0, true);
  const rem = nav.remainingBurn(n);
  world.maneuverDir = rem && vlen(rem) > 0.01 ? vnorm(rem) : null;
}

/** Light the next stage if no engine is burning yet. */
export function ignite(rig: Rig): void {
  const v = vessel(rig);
  if (!v.parts.some((p) => p.ignited && p.def.engine)) rig.world.stage();
}

/** Fly a maneuver node: coast to it, line up, burn until the remaining delta-v is gone, and cut the engine. */
export function executeNode(rig: Rig, node: ManeuverNode): number {
  const { world, nav } = rig;
  const v = vessel(rig);
  nav.refresh(0, 0, true);
  const est = burnEstimate(v);
  const dv = nodeMagnitude(node);
  const burn = Math.min(est.burnTime(dv), 3000);
  const startAt = node.ut - burn / 2;
  rig.log.push(`   node dv ${dv.toFixed(0)} burn estimate ${burn.toFixed(0)} s, start ${(startAt - world.ut).toFixed(0)} s from now`);
  coastTo(rig, startAt - 100);
  updateManeuverDir(rig, node);
  aimAlong(rig, 'maneuver', 0.4, 200);
  const spinUp = Math.max(0, startAt - world.ut);
  if (spinUp > 0) run(rig, spinUp, () => updateManeuverDir(rig, node));
  ignite(rig);
  const t0 = world.ut;
  const v0 = [...vessel(rig).vel] as V3;
  const planned = nav.remainingBurn(node);
  for (let i = 0; i < 200_000; i++) {
    const ve = vessel(rig);
    updateManeuverDir(rig, node);
    const rem = nav.remainingBurn(node);
    const m = rem ? vlen(rem) : 0;
    if (!rem || m < 0.4 || (world.ut - t0 > burn * 2.5 + 30)) break;
    const accel = ve.tele.thrust > 0 ? ve.tele.thrust / ve.mass.mass : est.thrust / ve.mass.mass;
    ve.throttle = clamp(m / (accel * 1.0), 0.05, 1);
    if (i % 1200 === 0) rig.log.push(`   burn t=${(world.ut - t0).toFixed(0)} rem=${m.toFixed(1)} thr=${ve.throttle.toFixed(2)} thrust=${(ve.tele.thrust / 1000).toFixed(0)}kN mass=${ve.mass.mass.toFixed(0)} err=${rem ? ((Math.acos(clamp(vdot(vnorm(rem), qrot(ve.q, [0, 1, 0])), -1, 1)) * 180) / Math.PI).toFixed(1) : '-'}deg`);
    run(rig, DT, undefined);
  }
  vessel(rig).throttle = 0;
  nav.removeNode(node.id);
  world.maneuverDir = null;
  const dvVec = vsub(vessel(rig).vel, v0);
  const ang = planned ? (Math.acos(clamp(vdot(vnorm(dvVec), vnorm(planned)), -1, 1)) * 180) / Math.PI : NaN;
  note(rig, `burn complete in ${(world.ut - t0).toFixed(0)} s: dv ${vlen(dvVec).toFixed(1)} (planned ${dv.toFixed(1)}), direction error ${ang.toFixed(2)} deg`);
  return world.ut - t0;
}

/** Evaluate how good a trajectory with a node is for a goal: returns the first patch around `body` (if any). */
export function patchesFor(rig: Rig, r: Vec3, v: Vec3, ut: number, body: string, nodes: ManeuverNode[], maxPatches = 4): Patch[] {
  return predictTrajectory(rig.model, { body, r, v, ut }, nodes, { maxPatches, maxOrbits: 3 }).patches;
}

export const periapsisAltitude = (p: Patch): number => p.elements.a * (1 - p.elements.e) - p.radius;

/**
 * Tune a node by coordinate search until the trajectory passes `body` at periapsis altitude `targetAlt`: what a player does with
 * the node handles, watching the predicted encounter. `vary` says what may change: the three burn parts and the time (10 s units).
 */
export function tuneNode(rig: Rig, start: { ut: number; prograde: number; normal: number; radial: number }, body: string, targetAlt: number, opts: { time?: boolean; flyby?: boolean; maxPatches?: number; penalty?: number; step0?: number } = {}): ManeuverNode | null {
  const { world } = rig;
  const v = vessel(rig);
  const base = { r: v.pos, v: v.vel, ut: world.ut };
  const cost = (x: number[]): number => {
    const node: ManeuverNode = { id: 99, ut: start.ut + x[3]! * 10, prograde: start.prograde + x[0]!, normal: start.normal + x[1]!, radial: start.radial + x[2]! };
    if (node.ut < base.ut + 5) return 1e13;
    const patches = predictTrajectory(rig.model, { body: world.bodyId, r: base.r, v: base.v, ut: base.ut }, [node], { maxPatches: opts.maxPatches ?? 4, maxOrbits: 3 }).patches;
    const hit = patches.find((p) => p.body === body);
    if (!hit) {
      const first = patches.find((p) => p.nodeId === null && p.startUt >= node.ut - 1) ?? patches[patches.length - 1]!;
      const ca = closestApproach(rig.model, first, body);
      return 1e10 + (ca ? ca.distance : 1e9);
    }
    if ((opts.flyby ?? true) && hit.end === 'impact') return 5e8 + Math.abs(periapsisAltitude(hit));
    return Math.abs(periapsisAltitude(hit) - targetAlt) + (opts.penalty ?? 20_000) * Math.hypot(x[0]!, x[1]!, x[2]!);
  };
  let cur = [0, 0, 0, 0];
  let curCost = cost(cur);
  for (let step = opts.step0 ?? 64; step >= 0.0625; step /= 2) {
    let improved = true;
    for (let it = 0; improved && it < 80; it++) {
      improved = false;
      for (let axis = 0; axis < (opts.time ? 4 : 3); axis++) {
        for (const sign of [-1, 1]) {
          const trial = [...cur];
          trial[axis] = trial[axis]! + sign * step * (axis === 3 ? 0.5 : 1);
          const c = cost(trial);
          if (c < curCost) {
            cur = trial;
            curCost = c;
            improved = true;
          }
        }
      }
    }
  }
  if (curCost >= 5e8) return null;
  return rig.nav.addNode(start.ut + cur[3]! * 10, { prograde: start.prograde + cur[0]!, normal: start.normal + cur[1]!, radial: start.radial + cur[2]! });
}



const aglOf = (rig: Rig, v: Vessel): number => altitudeOf(rig.world.env, v.pos) - (rig.world.env.groundRadius(v.pos) - rig.world.env.radius);

/** Burn retrograde (SAS) until the periapsis is down to `peAlt`, then cut. */
export function lowerPeriapsis(rig: Rig, peAlt: number): void {
  const { world } = rig;
  const v = vessel(rig);
  aimAlong(rig, 'retrograde', 3, 120);
  ignite(rig);
  for (let t = 0; t < 600; t += DT) {
    world.step(DT);
    const ve = vessel(rig);
    const o = orbitInfo(ve.pos, ve.vel, world.env.mu, world.env.radius);
    ve.throttle = o.periapsis < peAlt ? 0 : clamp((o.periapsis - peAlt) / 20_000 + 0.1, 0.1, 1);
    if (o.periapsis < peAlt) break;
  }
  v.throttle = 0;
  note(rig, 'periapsis lowered');
}

/**
 * Powered descent with explicit guidance: thrust is steered between "against the horizontal motion" and "up" so that the vessel
 * stops its sideways speed while sinking at a rate that reaches the ground just as it stops, then hovers down the last metres.
 * Returns when the vessel has been at rest on the ground for a while (or throws).
 */
export function powerDescent(rig: Rig, maxSeconds = 1500): void {
  const { world } = rig;
  vessel(rig).legsOut = true;
  vessel(rig).sas.enabled = true;
  vessel(rig).sas.mode = 'maneuver';
  let rest = 0;
  let started = false;
  for (let t = 0; t < maxSeconds; t += DT) {
    world.step(DT);
    const v = vessel(rig);
    const env = world.env;
    const { up } = horizon(env, v.pos);
    const vs = vsub(v.vel, surfaceVelocity(env, v.pos));
    const vz = vdot(vs, up);
    const vhVec = vsub(vs, vscale(up, vz));
    const vh = vlen(vhVec);
    const agl = aglOf(rig, v);
    const r = vlen(v.pos);
    const g = env.mu / (r * r);
    const aMax = (v.tele.thrust > 0 ? v.tele.thrust : burnEstimate(v).thrust) / v.mass.mass;
    if (v.situation === 'rest') {
      rest += DT;
      v.throttle = 0;
      world.maneuverDir = null;
      if (rest > 3) {
        const tilt = (Math.acos(clamp(vdot(qrot(v.q, [0, 1, 0]), up), -1, 1)) * 180) / Math.PI;
        note(rig, `at rest, tilt ${tilt.toFixed(1)} deg, ${v.parts.length} parts`);
        return;
      }
      continue;
    }
    const centrifugal = (vh * vh) / r;
    let wantUp: number;
    let wantH: number;
    if (vh > 4) {
      // sink at a rate that reaches 300 m above the ground just as the sideways speed is gone, using most of the thrust for stopping
      const stopTime = vh / Math.max(aMax * 0.6, 0.5);
      const vzWanted = -clamp((agl - 300) / Math.max(stopTime, 5), 0, 80);
      wantUp = Math.max(g - centrifugal + 1.2 * (vzWanted - vz), 0.1 * g);
      wantH = Math.sqrt(Math.max((aMax * 0.97) ** 2 - wantUp * wantUp, 0));
      if (!started && vh > 200 && agl > 14_000) {
        v.throttle = 0;
        continue; // wait for the periapsis
      }
    } else {
      const vzWanted = -clamp(Math.sqrt(2 * 0.45 * Math.max(agl - 3, 0)), 0.5, 60);
      wantUp = g + 1.2 * (vzWanted - vz);
      wantH = Math.min(vh * 1.0, 1.2); // keep nulling the last sideways drift so the lander does not tip over
    }
    started = true;
    wantUp = Math.max(wantUp, 0.2 * g);
    const dir = vnorm(vadd(vscale(up, wantUp), vh > 0.05 ? vscale(vnorm(vhVec), -wantH) : [0, 0, 0]));
    world.maneuverDir = dir;
    const nose = qrot(v.q, [0, 1, 0]);
    const misaligned = (Math.acos(clamp(vdot(nose, dir), -1, 1)) * 180) / Math.PI;
    v.throttle = misaligned > 60 ? 0 : clamp(Math.hypot(wantUp, wantH) / aMax, agl < 200 ? 0.12 : 0, 1); // keep the engine lit near the ground: the gimbal is what steers a lander
    if (agl < 40 && Math.round(t * 120) % 30 === 0) rig.log.push(`   touch t=${t.toFixed(1)} agl=${agl.toFixed(2)} clr=${v.tele.clearance.toFixed(2)} vz=${vz.toFixed(2)} vh=${vh.toFixed(2)} tilt=${((Math.acos(clamp(vdot(qrot(v.q, [0, 1, 0]), up), -1, 1)) * 180) / Math.PI).toFixed(1)} w=${vlen(v.w).toFixed(3)} thr=${v.throttle.toFixed(2)} touching=${v.touching.size} sit=${v.situation}`);
    if (v.touching.size >= 2 && vz > -2) {
      v.throttle = 0; // on the ground: engine off
      continue;
    }
    if (Math.round(t * 120) % 600 === 0) rig.log.push(`   descent t=${t.toFixed(0)} agl=${agl.toFixed(0)} vz=${vz.toFixed(1)} vh=${vh.toFixed(1)} thr=${v.throttle.toFixed(2)} err=${misaligned.toFixed(0)} mass=${v.mass.mass.toFixed(0)} aMax=${aMax.toFixed(2)}`);
  }
  throw new Error('The descent did not end in a landing.' + String.fromCharCode(10) + rig.log.join(String.fromCharCode(10)));
}

/** Lift off from the ground and fly to a circular orbit of `altitude`: a gentle kick, a prograde gravity turn, circularise at apoapsis. */
export function ascendToOrbit(rig: Rig, altitude = 100_000): void {
  const { world } = rig;
  let v = vessel(rig);
  const env = world.env;
  world.stage(); // drop the descent stage and light the ascent engine
  v = vessel(rig);
  v.sas.enabled = true;
  v.sas.mode = 'stability';
  let phase = 'rise';
  let kick = 0;
  for (let t = 0; t < 1500; t += DT) {
    world.step(DT);
    v = vessel(rig);
    const { up } = horizon(env, v.pos);
    const vs = vsub(v.vel, surfaceVelocity(env, v.pos));
    const vz = vdot(vs, up);
    const agl = aglOf(rig, v);
    const g = env.mu / vdot(v.pos, v.pos);
    const aMax = burnEstimate(v).thrust / v.mass.mass;
    const orb = orbitInfo(v.pos, v.vel, env.mu, env.radius);
    if (Math.round(t * 120) % 240 === 0 && t < 40) rig.log.push(`   ascent tilt=${((Math.acos(clamp(vdot(qrot(v.q, [0, 1, 0]), up), -1, 1)) * 180) / Math.PI).toFixed(0)} t=${t.toFixed(0)} ${v.situation} thrust=${(v.tele.thrust / 1000).toFixed(1)} mass=${v.mass.mass.toFixed(0)} parts=${v.parts.length} stage=${v.nextStage} ${phase} agl=${agl.toFixed(0)} vz=${vz.toFixed(1)} thr=${v.throttle.toFixed(2)} ap=${(orb.apoapsis / 1000).toFixed(1)} pe=${(orb.periapsis / 1000).toFixed(1)} fuel=${Math.round(v.parts.reduce((x, p) => x + p.fuel, 0))}`);
    if (phase === 'rise') {
      v.throttle = clamp((2.2 * g) / aMax, 0.05, 1);
      if (agl > 150 && vz > 20) {
        phase = 'kick';
        kick = t;
      }
    } else if (phase === 'kick') {
      v.controls.pitch = 0.5;
      v.throttle = clamp((2.2 * g) / aMax, 0.05, 1);
      if (t - kick > 1.2) {
        v.controls.pitch = 0;
        v.sas.mode = 'prograde';
        phase = 'turn';
      }
    } else if (phase === 'turn') {
      v.throttle = clamp((2.4 * g) / aMax, 0.05, 1);
      if (orb.apoapsis > altitude) {
        v.throttle = 0;
        phase = 'coast';
      }
    } else if (phase === 'coast') {
      v.throttle = 0;
      if (agl > (env.railsFloor ?? 15_000) && nav(rig)) {
        coastTo(rig, world.ut + Math.max(0, orb.timeToApoapsis - 30));
        phase = 'circularise';
        aimAlong(rig, 'prograde', 3, 60);
      }
    } else {
      v.sas.mode = 'prograde';
      v.throttle = orb.periapsis > altitude - 8_000 ? 0 : clamp((altitude - orb.periapsis) / 8_000, 0.1, 1);
      if (orb.periapsis > altitude - 8_000 && orb.timeToApoapsis < 1e9) {
        v.throttle = 0;
        note(rig, 'in orbit');
        return;
      }
      if (orb.timeToApoapsis > 200 && orb.timeToPeriapsis > 10) {
        // not yet at the apoapsis: wait
        v.throttle = 0;
      }
    }
  }
  throw new Error('The ascent did not reach orbit.' + String.fromCharCode(10) + rig.log.join(String.fromCharCode(10)));
}
const nav = (rig: Rig): boolean => rig.nav.railsBlocker() === null;

/** Find the burn that sends a vessel in orbit about the Moon back towards an Earth re-entry corridor, as a player would on the map. */
export function planReturn(rig: Rig, targetAlt = 45_000): ManeuverNode {
  const { world } = rig;
  const v = vessel(rig);
  let best: { ut: number; cost: number } | null = null;
  const orbit = orbitInfo(v.pos, v.vel, world.env.mu, world.env.radius);
  for (let dt = 60; dt < orbit.period * 3; dt += 90) {
    const ut = world.ut + dt;
    const s = propagateState(v, world.env.mu, dt);
    const node: ManeuverNode = { id: 98, ut, prograde: 900, normal: 0, radial: 0 };
    const patches = predictTrajectory(rig.model, { body: world.bodyId, r: v.pos, v: v.vel, ut: world.ut }, [node], { maxPatches: 3, maxOrbits: 4 }).patches;
    void s;
    const earth = patches.find((p) => p.body === 'earth');
    if (!earth) continue;
    const cost = Math.abs(periapsisAltitude(earth) - targetAlt);
    if (!best || cost < best.cost) best = { ut, cost };
  }
  if (!best) throw new Error('No return burn found.' + String.fromCharCode(10) + rig.log.join(String.fromCharCode(10)));
  const tuned = tuneNode(rig, { ut: best.ut, prograde: 900, normal: 0, radial: 0 }, 'earth', targetAlt, { time: true, penalty: 0, step0: 8 });
  if (!tuned) throw new Error('The return burn could not be tuned.');
  return tuned;
}

function propagateState(v: Vessel, mu: number, dt: number): { r: Vec3; v: Vec3 } {
  return propagate({ r: v.pos, v: v.vel }, mu, dt);
}

/** Coast home, drop the service module, ride the capsule down on its heat shield and parachute. Returns the peak hull heat seen. */
export function reenterAndLand(rig: Rig): { peakHeat: number; touchdownSpeed: number } {
  const { world } = rig;
  const deadline = world.ut + 14 * 86400;
  let reason = coastTo(rig, deadline);
  while (reason === 'soi' && world.bodyId !== 'earth') reason = coastTo(rig, deadline);
  if (reason === 'soi') {
    // in Earth's sphere of influence: a last course correction a few hours before the air, aiming for the middle of the entry corridor
    rig.nav.refresh(0, 0, true);
    const floorUt = rig.nav.trajectory?.patches[0]?.floorUt;
    rig.log.push(`   entering Earth SOI: floor in ${floorUt ? ((floorUt - world.ut) / 3600).toFixed(1) : 'never'} h, patches ${rig.nav.trajectory?.patches.map((p) => p.body + ':' + p.end).join(',')}`);
    if (floorUt) {
      note(rig, 'coasting to the correction point');
      coastTo(rig, floorUt - 6 * 3600);
      note(rig, 'at the correction point, active=' + String(!!world.active));
      correctCourse(rig, 'earth', 45_000, 20_000, 1800, 3);
      note(rig, 'corrected');
    }
    reason = coastTo(rig, deadline);
  }
  note(rig, 'at the top of the atmosphere');
  vessel(rig).throttle = 0;
  world.stage(); // drop the service module
  const v = vessel(rig);
  v.sas.enabled = true;
  v.sas.mode = 'retrograde';
  let peakHeat = 0;
  let armed = false;
  let touchdown = 0;
  for (let t = 0; t < 2400; t += DT) {
    world.step(DT);
    const ve = rig.world.active;
    if (!ve) throw new Error('The capsule was lost in re-entry.' + String.fromCharCode(10) + rig.log.join(String.fromCharCode(10)) + String.fromCharCode(10) + world.vessels.flatMap((x) => x.log).join(String.fromCharCode(10)));
    peakHeat = Math.max(peakHeat, ve.tele.heat);
    for (const line of ve.log.splice(0)) rig.log.push(`   vessel: ${line} (t=${t.toFixed(0)}, agl ${(aglOf(rig, ve) / 1000).toFixed(1)} km)`);
    ve.sas.mode = 'retrograde';
    const agl = aglOf(rig, ve);
    const speedNow = vlen(vsub(ve.vel, surfaceVelocity(world.env, ve.pos)));
    if (!armed && agl < 14_000 && speedNow < 450) {
      world.stage(); // parachutes
      armed = true;
    }
    if (Math.round(t * 120) % 1200 === 0) rig.log.push(`   entry t=${t.toFixed(0)} agl=${(agl / 1000).toFixed(1)}km speed=${vlen(vsub(ve.vel, surfaceVelocity(world.env, ve.pos))).toFixed(0)} heat=${ve.tele.heat.toFixed(2)} g=${ve.tele.gForce.toFixed(1)}`);
    if (agl < 20) touchdown = Math.max(touchdown, vlen(vsub(ve.vel, surfaceVelocity(world.env, ve.pos))));
    if (ve.situation === 'rest') return { peakHeat, touchdownSpeed: touchdown };
  }
  throw new Error('The capsule never landed.' + String.fromCharCode(10) + rig.log.join(String.fromCharCode(10)));
}


/** Fly corrections (tune a node, burn it) until the predicted pass of `body` has periapsis within `tol` of `targetAlt`. */
export function correctCourse(rig: Rig, body: string, targetAlt: number, tol: number, leadSeconds: number, maxBurns = 4): void {
  const { world } = rig;
  for (let i = 0; i < maxBurns; i++) {
    const ve = vessel(rig);
    const now = patchesFor(rig, ve.pos, ve.vel, world.ut, world.bodyId, [], 4).find((p) => p.body === body);
    if (now && Math.abs(periapsisAltitude(now) - targetAlt) < tol) return;
    const node = tuneNode(rig, { ut: world.ut + leadSeconds, prograde: 0, normal: 0, radial: 0 }, body, targetAlt, { penalty: 0, step0: i === 0 ? 8 : 1 });
    if (!node) throw new Error('No correction found.' + String.fromCharCode(10) + rig.log.join(String.fromCharCode(10)));
    executeNode(rig, node);
  }
}

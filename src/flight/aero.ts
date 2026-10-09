/**
 * Aerodynamics: each part feels the air that reaches it (the vessel's velocity plus its own spin), so drag, lift and stability
 * come out of where the parts are. A part contributes
 *   - axial drag on whichever end faces the wind, if that end is exposed (a nose cone, a bare tank top, an engine bell),
 *   - cross-flow drag on its side, and a normal force that grows with angle of attack (weighted by its centre-of-pressure weight),
 *   - for fins and panels, a flat-plate lift model with optional control-surface deflection,
 *   - for deployed parachutes, canopy drag.
 * The forces act at the part's position, so the torque about the centre of mass is what makes a rocket weathervane or tumble.
 * All vectors are in the body frame. Pure maths.
 */
import { machDragFactor, speedOfSound } from './atmosphere';
import { clamp, vcross, vdot, vlen, vscale, vsub, type V3 } from './math3';
import { rotate } from '../builder/craft';
import type { FlightPart, Vessel } from './vessel';

const CROSS_FLOW_CD = 1.1;
const NORMAL_SLOPE = 2; // per radian, times the part's centre-of-pressure weight
const PLATE_SLOPE = 3.4;
const PLATE_MAX = 1.3;
const FLAT_END_CD = 0.8;
const BASE_CD = 0.45;
const SKIN_CF = 0.004;
const MAX_FIN_DEFLECTION = (22 * Math.PI) / 180;

/** Canopy area (m^2) and drag coefficient of each parachute. */
export const CHUTE_AREA: Record<string, number> = { 'chute-drogue': 15, 'chute-main': 100, 'chute-radial': 30 };
const CHUTE_CD = 1.4;

export interface AeroResult {
  force: V3;
  torque: V3;
  /** Force on each part (body frame), for the structural load check. */
  perPart: Map<string, V3>;
}

const isPlate = (p: FlightPart): boolean => p.def.look === 'fin' || p.def.look === 'panel';

/** Mix weights for control-surface deflection: how a fin should move for unit pitch, yaw and roll requests. */
export function finMix(v: Vessel, p: FlightPart): V3 {
  const com = v.mass.com;
  const r = vsub(p.pos, com);
  const n = rotate(p, [0, 0, 1]);
  const hinge = rotate(p, [1, 0, 0]);
  const lift = vscale(n, -vdot([0, 1, 0], vcross(hinge, n))); // force direction per unit deflection, flying nose first
  const t = vcross(r, lift); // torque per unit deflection about body X, Y, Z
  // pitch control is torque about -Z, yaw about +X, roll about +Y
  const m: V3 = [t[0], t[1], -t[2]];
  const big = Math.max(Math.abs(m[0]), Math.abs(m[1]), Math.abs(m[2]), 1e-9);
  return [m[2] / big, m[0] / big, m[1] / big].map((x) => (Math.abs(x) < 0.25 ? 0 : x)) as V3; // [pitch, yaw, roll]
}

/**
 * Forces and torque of the air on the vessel.
 * `vRel` is the vessel's centre-of-mass velocity relative to the air (body frame), `w` its angular velocity (body frame).
 */
export function aeroForces(v: Vessel, vRel: V3, w: V3, density: number, temperature: number, cmd: { pitch: number; yaw: number; roll: number }): AeroResult {
  const force: V3 = [0, 0, 0];
  const torque: V3 = [0, 0, 0];
  const perPart = new Map<string, V3>();
  if (density <= 1e-9) return { force, torque, perPart };
  const com = v.mass.com;
  const sound = speedOfSound(temperature);
  const top = v.exposedTop;
  const bottom = v.exposedBottom;

  for (const p of v.parts) {
    const r = vsub(p.pos, com);
    const vp = vsub(vRel, vcross(r, w)); // wind-relative velocity of this part: v + w x r, with r x w = -(w x r)
    const speed = vlen(vp);
    if (speed < 0.05) continue;
    const dir: V3 = [vp[0] / speed, vp[1] / speed, vp[2] / speed]; // direction of the part's motion through the air
    const q = 0.5 * density * speed * speed;
    const cm = machDragFactor(speed / sound);
    const d = p.def;
    let f: V3 = [0, 0, 0];

    if (p.chute !== 'stowed' && p.chute !== 'armed' && p.chute !== 'cut') {
      const area = (CHUTE_AREA[d.id] ?? 20) * Math.max(0.05, p.chuteDeploy) ** 1.5;
      f = vscale(dir, -q * CHUTE_CD * area);
    } else if (isPlate(p)) {
      f = plateForce(p, dir, q, cmd, finMix(v, p));
    } else {
      const axis = rotate(p, [0, 1, 0]);
      const ca = vdot(dir, axis);
      const lateral = vsub(dir, vscale(axis, ca));
      const sa = vlen(lateral);
      const radius = d.surface ? Math.max(d.radius, 0.1) : d.radius;
      const frontArea = Math.PI * radius * radius;
      // axial drag on the exposed end that faces the wind
      let cdArea = 0;
      if (ca > 0 && top.has(p.id)) cdArea = (isNose(p) ? d.cd : FLAT_END_CD) * frontArea;
      else if (ca < 0 && bottom.has(p.id)) cdArea = (d.engine ? 0.3 : BASE_CD) * frontArea;
      const skin = SKIN_CF * 2 * Math.PI * radius * d.height * Math.abs(ca) * cm;
      f = vscale(axis, -q * (cdArea * cm * Math.abs(ca) * Math.sign(ca) + skin * Math.sign(ca)));
      // cross-flow drag plus normal force: along the lateral direction, against the lateral motion
      if (sa > 1e-4) {
        const sideArea = 2 * radius * d.height;
        const lat = q * (CROSS_FLOW_CD * sideArea * sa * sa + NORMAL_SLOPE * d.cpWeight * 2 * sa * Math.abs(ca));
        f = [f[0] - (lateral[0] / sa) * lat, f[1] - (lateral[1] / sa) * lat, f[2] - (lateral[2] / sa) * lat];
      }
    }
    force[0] += f[0];
    force[1] += f[1];
    force[2] += f[2];
    const t = vcross(r, f);
    torque[0] += t[0];
    torque[1] += t[1];
    torque[2] += t[2];
    perPart.set(p.id, f);
  }
  return { force, torque, perPart };
}

/** Parts whose top end is the aerodynamic nose: cones, fairings, pods, parachute canisters. */
const isNose = (p: FlightPart): boolean => ['cone', 'fairing', 'pod', 'chute', 'probe'].includes(p.def.look);

function plateForce(p: FlightPart, dir: V3, q: number, cmd: { pitch: number; yaw: number; roll: number }, mix: V3): V3 {
  const area = p.def.height * p.def.radius * 0.65;
  let n = rotate(p, [0, 0, 1]);
  if (p.def.control) {
    const delta = clamp(mix[0] * cmd.pitch + mix[1] * cmd.yaw + mix[2] * cmd.roll, -1, 1) * MAX_FIN_DEFLECTION * p.def.control;
    const hinge = rotate(p, [1, 0, 0]);
    const tilt = vcross(hinge, n);
    n = [n[0] * Math.cos(delta) + tilt[0] * Math.sin(delta), n[1] * Math.cos(delta) + tilt[1] * Math.sin(delta), n[2] * Math.cos(delta) + tilt[2] * Math.sin(delta)];
  }
  const s = vdot(dir, n);
  const cn = clamp(PLATE_SLOPE * s, -PLATE_MAX, PLATE_MAX);
  const drag = q * area * (0.02 + Math.abs(cn * s));
  const normal = -q * area * cn;
  return [n[0] * normal - dir[0] * drag, n[1] * normal - dir[1] * drag, n[2] * normal - dir[2] * drag];
}


/**
 * Flight reference vectors (up, east, prograde...) and the stability assist (SAS). SAS turns an attitude target into
 * pitch/yaw/roll requests in -1..1, scaled by the torque the vessel can actually produce, so a heavy rocket with weak wheels
 * turns slowly instead of oscillating. Pure maths.
 */
import { altitudeOf, horizon, surfaceVelocity, type FlightEnv } from './env';
import { clamp, qconj, qmul, qrotInv, vcross, vdot, vlen, vnorm, vsub, type Quat, type V3 } from './math3';
import type { SasMode, Vessel } from './vessel';

/** Below this altitude the navball shows velocity relative to the surface; above it, orbital velocity. */
export const SPEED_MODE_SWITCH_ALTITUDE = 36_000;

export interface FlightVectors {
  up: V3;
  east: V3;
  north: V3;
  velSurface: V3;
  velOrbit: V3;
  speedMode: 'surface' | 'orbit';
  /** Unit vectors in the inertial frame. */
  prograde: V3;
  normal: V3;
  radialOut: V3;
  /** Direction of the maneuver burn still to fly (set by the world from its navigator), if any. */
  maneuver: V3 | null;
}

export function flightVectors(v: Vessel, env: FlightEnv): FlightVectors {
  const { up, east, north } = horizon(env, v.pos);
  const velOrbit = v.vel;
  const velSurface = vsub(v.vel, surfaceVelocity(env, v.pos));
  const speedMode = altitudeOf(env, v.pos) < SPEED_MODE_SWITCH_ALTITUDE ? 'surface' : 'orbit';
  const ref = speedMode === 'surface' ? velSurface : velOrbit;
  const prograde = vlen(ref) > 0.5 ? vnorm(ref) : up;
  let normal = vnorm(vcross(v.pos, velOrbit));
  if (vlen(normal) < 1e-9) normal = north;
  // radial out: away from the body, made perpendicular to prograde
  const r = vsub(up, [prograde[0] * vdot(up, prograde), prograde[1] * vdot(up, prograde), prograde[2] * vdot(up, prograde)]);
  const radialOut = vlen(r) > 1e-6 ? vnorm(r) : up;
  return { up, east, north, velSurface, velOrbit, speedMode, prograde, normal, radialOut, maneuver: null };
}

const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];

/** The direction (inertial) the nose should point for a SAS mode, or null for 'stability' (hold the current attitude). */
export function sasTarget(mode: SasMode, fv: FlightVectors): V3 | null {
  switch (mode) {
    case 'prograde':
      return fv.prograde;
    case 'retrograde':
      return neg(fv.prograde);
    case 'normal':
      return fv.normal;
    case 'antinormal':
      return neg(fv.normal);
    case 'radialOut':
      return fv.radialOut;
    case 'radialIn':
      return neg(fv.radialOut);
    case 'maneuver':
      return fv.maneuver;
    default:
      return null;
  }
}

const MAX_TURN_RATE = 0.7; // rad/s
const RATE_GAIN = 1.1; // desired turn rate per radian of error
const RESPONSE_TIME = 0.5; // s to correct a rate error

/**
 * SAS output for this step: requests [pitch, yaw, roll] in -1..1. `authority` is the torque available about body X, Y, Z (N m).
 * Roll is only damped unless holding a full attitude.
 */
export function sasCommand(v: Vessel, fv: FlightVectors, authority: V3): { pitch: number; yaw: number; roll: number } {
  const target = sasTarget(v.sas.mode, fv);
  let err: V3; // rotation vector (body frame) that would carry the vessel onto the target
  let rollHeld = false;
  if (target) {
    const tb = qrotInv(v.q, target); // target in body axes; the nose is (0, 1, 0)
    const angle = Math.acos(clamp(tb[1], -1, 1));
    const axis: V3 = [tb[2], 0, -tb[0]]; // nose x target
    const n = vlen(axis);
    err = n > 1e-9 ? [(axis[0] / n) * angle, 0, (axis[2] / n) * angle] : tb[1] < 0 ? [Math.PI, 0, 0] : [0, 0, 0];
  } else {
    const hold = v.sas.hold ?? v.q;
    const qe = qmul(qconj(v.q), hold); // from body to the held attitude, in body axes
    const s = qe[3] < 0 ? -1 : 1;
    err = [2 * s * qe[0], 2 * s * qe[1], 2 * s * qe[2]];
    rollHeld = true;
  }
  const out: [number, number, number] = [0, 0, 0];
  const inertia = v.mass.inertia;
  const axes: Array<{ i: number; I: number; a: number }> = [
    { i: 0, I: inertia[0], a: authority[0] },
    { i: 1, I: inertia[4], a: authority[1] },
    { i: 2, I: inertia[8], a: authority[2] },
  ];
  for (const { i, I, a } of axes) {
    const e = i === 1 && !rollHeld ? 0 : err[i]!;
    const desired = clamp(e * RATE_GAIN, -MAX_TURN_RATE, MAX_TURN_RATE);
    const accel = (desired - v.w[i]!) / RESPONSE_TIME;
    out[i] = a > 1 ? clamp((accel * I) / a, -1, 1) : 0;
  }
  // Body X torque is yaw (+X), body Z torque is minus pitch, Y is roll.
  return { pitch: -out[2], yaw: out[0], roll: out[1] };
}

/** Attitude to hold in stability mode (the current one, captured when SAS engages or the pilot lets go). */
export const captureHold = (q: Quat): Quat => [q[0], q[1], q[2], q[3]];

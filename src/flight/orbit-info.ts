/** Orbit readouts for the flight HUD, from a position/velocity relative to the body. Pure maths. */
import { orbitalPeriod, stateToElements, TWO_PI, wrapPi } from '../physics/kepler';
import { vcross, vdot, vlen, type V3 } from './math3';

export interface OrbitInfo {
  /** True when the orbit is closed (bound). */
  bound: boolean;
  semiMajor: number;
  eccentricity: number;
  /** Altitudes above the body's radius (m); apoapsis is Infinity for an escape trajectory. */
  apoapsis: number;
  periapsis: number;
  /** Inclination to the body's equator (radians). */
  inclination: number;
  period: number;
  /** Seconds until apoapsis / periapsis (NaN if not defined). */
  timeToApoapsis: number;
  timeToPeriapsis: number;
  /** Specific orbital energy (J/kg). */
  energy: number;
}

export function orbitInfo(pos: V3, vel: V3, mu: number, radius: number, spinAxis: V3 = [0, 1, 0]): OrbitInfo {
  const r = vlen(pos);
  const energy = (vdot(vel, vel) / 2) - mu / r;
  const h = vcross(pos, vel);
  const hn = vlen(h);
  const inclination = hn > 0 ? Math.acos(Math.max(-1, Math.min(1, vdot(h, spinAxis) / hn))) : 0;
  const el = stateToElements({ r: pos, v: vel }, mu, 0);
  const bound = energy < 0 && el.e < 1;
  if (!bound) {
    return { bound: false, semiMajor: el.a, eccentricity: el.e, apoapsis: Infinity, periapsis: el.a * (1 - el.e) - radius, inclination, period: Infinity, timeToApoapsis: NaN, timeToPeriapsis: NaN, energy };
  }
  const period = orbitalPeriod(el.a, mu);
  const n = TWO_PI / period;
  const M = wrapPi(el.M0); // mean anomaly now
  const toPe = (((TWO_PI - M) % TWO_PI) + TWO_PI) % TWO_PI / n;
  const toAp = ((((Math.PI - M) % TWO_PI) + TWO_PI) % TWO_PI) / n;
  return {
    bound: true,
    semiMajor: el.a,
    eccentricity: el.e,
    apoapsis: el.a * (1 + el.e) - radius,
    periapsis: el.a * (1 - el.e) - radius,
    inclination,
    period,
    timeToApoapsis: toAp,
    timeToPeriapsis: toPe,
    energy,
  };
}

/** What the flight physics needs to know about the world a vessel is in (one dominant body at a time). */
import type { AirModel } from './atmosphere';
import { qrot, qrotInv, vadd, vcross, vlen, vnorm, vscale, vsub, vdot, type Quat, type V3 } from './math3';

export interface FlightEnv {
  /** Gravitational parameter (m^3/s^2) and sea-level radius (m) of the body. */
  mu: number;
  radius: number;
  /** Spin of the body: unit axis in the inertial frame and rate (rad/s). */
  spinAxis: V3;
  spinRate: number;
  /** Atmosphere, or null for an airless body. */
  air: AirModel | null;
  /** Body-fixed -> inertial rotation, refreshed by the caller before each step. */
  planetQuat: Quat;
  /** Distance from the body's centre to the terrain surface under the inertial position `p` (metres). */
  groundRadius(p: V3): number;
  /** Direction to the Sun (inertial, unit), for solar power; null means always lit. */
  sunDir: V3 | null;
  /** Catalogue id of the body (for sphere-of-influence hand-offs and the HUD). */
  id?: string;
  /** Below this altitude (m) the vessel must be simulated in full, never on rails: the top of the air, or above the mountains. */
  railsFloor?: number;
  /** Ambient pressure (Pa) beyond which the vessel is crushed. */
  crushPressure?: number;
  /** Called by the world before each step with the universal time, to refresh `planetQuat` and `sunDir`. */
  update?(ut: number): void;
}

/** Velocity of the surface (and the air) at inertial position `p`. */
export const surfaceVelocity = (env: FlightEnv, p: V3): V3 => vcross(vscale(env.spinAxis, env.spinRate), p);

export const altitudeOf = (env: FlightEnv, p: V3): number => vlen(p) - env.radius;

/** Rest-frame conversion: inertial <-> body-fixed. */
export const toBodyFixed = (env: FlightEnv, p: V3): V3 => qrotInv(env.planetQuat, p);
export const fromBodyFixed = (env: FlightEnv, p: V3): V3 => qrot(env.planetQuat, p);

/** Local horizon frame at `p`: up, and east/north from the spin axis. */
export function horizon(env: FlightEnv, p: V3): { up: V3; east: V3; north: V3 } {
  const up = vnorm(p);
  let east = vcross(env.spinAxis, up);
  if (vlen(east) < 1e-9) east = [1, 0, 0]; // at a pole any direction will do
  east = vnorm(east);
  const north = vnorm(vcross(up, east));
  return { up, east, north };
}

/** Is the point in sunlight (not in the body's shadow)? */
export function sunlit(env: FlightEnv, p: V3): boolean {
  if (!env.sunDir) return true;
  const along = vdot(p, env.sunDir);
  if (along > 0) return true;
  const perp = vlen(vsub(p, vscale(env.sunDir, along)));
  return perp > env.radius;
}

export const pointAt = (center: V3, local: V3): V3 => vadd(center, local);

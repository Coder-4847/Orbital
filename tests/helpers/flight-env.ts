import { earthAir } from '../../src/flight/atmosphere';
import type { FlightEnv } from '../../src/flight/env';
import { FlightWorld } from '../../src/flight/flight-world';
import { qfromAxisAngle, qfromBasis, vcross, vlen, vnorm, type V3 } from '../../src/flight/math3';

export const EARTH_MU = 3.986004418e14;
export const EARTH_R = 6.371e6;
export const EARTH_SPIN = 7.292115e-5;

/** A spherical, smooth Earth spinning about +Y, with the standard atmosphere. Overrides tweak individual fields. */
export function testEnv(over: Partial<FlightEnv> = {}): FlightEnv {
  const env: FlightEnv = {
    mu: EARTH_MU,
    radius: EARTH_R,
    spinAxis: [0, 1, 0],
    spinRate: EARTH_SPIN,
    air: earthAir,
    planetQuat: [0, 0, 0, 1],
    groundRadius: () => EARTH_R,
    sunDir: null,
    update(ut: number) {
      env.planetQuat = qfromAxisAngle([0, 1, 0], env.spinRate * ut);
    },
    ...over,
  };
  return env;
}

export const worldAt = (over: Partial<FlightEnv> = {}): FlightWorld => new FlightWorld(testEnv(over), 0);

/** Run `seconds` of physics at 120 Hz. Returns when `until` says stop (or the time is up). */
export function run(world: FlightWorld, seconds: number, until?: () => boolean): number {
  const dt = 1 / 120;
  let t = 0;
  while (t < seconds) {
    world.step(dt);
    t += dt;
    if (until?.()) break;
  }
  return t;
}

/** A pad on the equator at longitude 0 (body-fixed +Z is lon 0 in this test frame, so any direction is fine). */
export const PAD = { direction: [0.3, 0.9, 0.3] as V3, headingDeg: 90 };

export const speedRelative = (world: FlightWorld, v = world.active!): number => {
  const w: V3 = [world.env.spinRate * world.env.spinAxis[0], world.env.spinRate * world.env.spinAxis[1], world.env.spinRate * world.env.spinAxis[2]];
  const s: V3 = [w[1] * v.pos[2] - w[2] * v.pos[1], w[2] * v.pos[0] - w[0] * v.pos[2], w[0] * v.pos[1] - w[1] * v.pos[0]];
  return vlen([v.vel[0] - s[0], v.vel[1] - s[1], v.vel[2] - s[2]]);
};

export const unit = vnorm;

/** Attitude with the nose along `up` (body +Y) and body +X horizontal. */
export function uprightQ(up: V3) {
  const u = vnorm(up);
  const x = vnorm(vcross([0, 1, 0], u));
  return qfromBasis(x, u, vcross(x, u));
}

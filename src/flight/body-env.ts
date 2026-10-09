/**
 * Flight environments for every body in the catalogue, built from the ephemeris alone (pure maths): gravity, spin, air, the
 * direction to the Sun and, through a host callback, the height of the ground. The scene supplies its terrain function as the
 * host's `groundHeight`; tests use a smooth sphere. One environment per body lets a vessel hand over between spheres of influence.
 */
import { ATMOSPHERES } from '../data/atmospheres';
import { bodyDef } from '../data/solar-system';
import type { Ephemeris } from '../physics/ephemeris';
import { earthAir, exponentialAir, type AirModel } from './atmosphere';
import type { FlightEnv } from './env';
import { qrot, vlen, vscale, type V3 } from './math3';

const DEG = Math.PI / 180;

/** Air of each atmospheric world: (surface or 1-bar pressure Pa, scale height m, temperature K). Earth has a layered model. */
export const AIR_MODELS: Record<string, AirModel> = {
  earth: earthAir,
  venus: exponentialAir(9_200_000, 15_900, 735),
  mars: exponentialAir(610, 11_100, 210),
  titan: exponentialAir(146_700, 21_000, 94),
  jupiter: exponentialAir(101_325, 27_000, 165),
  saturn: exponentialAir(101_325, 59_500, 134),
  uranus: exponentialAir(101_325, 27_700, 76),
  neptune: exponentialAir(101_325, 19_700, 72),
};

/** Where the world's bodies get posed and where its ground is. */
export interface BodyHost {
  ephemeris: Ephemeris;
  /** Pose every body at universal time `ut` (the shared ephemeris state, and the scene's planets with it). */
  advance(ut: number): void;
  /** Terrain height above the reference radius under `p`, a point relative to the body's centre (inertial axes). */
  groundHeight(id: string, p: V3): number;
}

/** Vessels are crushed at this ambient pressure: 120 bar, so Venus's surface is survivable and Jupiter's depths are not. */
export const CRUSH_PRESSURE = 1.2e7;
/** Airless worlds: stay out of rails below this height (m) so mountains are never skimmed at warp. */
const AIRLESS_RAILS_FLOOR = 15_000;
/** Gas giants have no ground: this far below the 1-bar level there is only pressure. */
const NO_GROUND_DEPTH = 5e7;

/** Height of the top of the atmosphere (m), 0 for airless bodies. */
export function atmosphereTop(id: string): number {
  const key = bodyDef(id).atmosphere;
  const def = key ? ATMOSPHERES[key] : undefined;
  return def ? def.topRadius - def.radius : 0;
}

export function bodyFlightEnv(host: BodyHost, id: string): FlightEnv {
  const def = bodyDef(id);
  const eph = host.ephemeris;
  const spinRate = (def.rotation.wdot * DEG) / 86400;
  const air = AIR_MODELS[id] ?? null;
  const gas = def.render === 'gas';
  const top = atmosphereTop(id);
  const env: FlightEnv = {
    id,
    mu: def.gm,
    radius: def.radius,
    spinAxis: [0, 1, 0],
    spinRate,
    air,
    planetQuat: [0, 0, 0, 1],
    sunDir: null,
    railsFloor: air ? Math.max(top, AIRLESS_RAILS_FLOOR) : def.render === 'sun' ? def.radius * 0.5 : AIRLESS_RAILS_FLOOR,
    crushPressure: air ? CRUSH_PRESSURE : undefined,
    groundRadius(p: V3): number {
      if (gas) return def.radius - NO_GROUND_DEPTH;
      if (def.render === 'sun') return def.radius;
      return def.radius + host.groundHeight(id, p);
    },
    update(ut: number) {
      host.advance(ut);
      const st = eph.get(id);
      env.planetQuat = [st.q[0], st.q[1], st.q[2], st.q[3]];
      env.spinAxis = qrot(env.planetQuat, [0, 1, 0]);
      const d = vlen(st.pos);
      env.sunDir = id === 'sun' || d < 1 ? null : vscale([-st.pos[0], -st.pos[1], -st.pos[2]], 1 / d);
    },
  };
  return env;
}

/** A host with smooth spheres for ground: tests, and any use without terrain. */
export function sphereHost(ephemeris: Ephemeris): BodyHost {
  return { ephemeris, advance: (ut) => ephemeris.update(ut), groundHeight: () => 0 };
}

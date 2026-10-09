/**
 * Mission-planning helper for tests: find when to fire a prograde burn from a circular parking orbit so that the transfer
 * orbit meets a target body's sphere of influence, by scanning the arrival day and the burn point.
 */
import { propagate, type Vec3 } from '../../src/physics/kepler';
import { predictTrajectory, type NavModel } from '../../src/flight/trajectory';

export interface TransferSearch {
  model: NavModel;
  body: string;
  r: Vec3;
  v: Vec3;
  ut: number;
  mu: number;
  /** The moon (child of `body`) to reach and the burn size (m/s). */
  target: string;
  dv: number;
  /** Time (s) the transfer takes, roughly: the burn is placed this long before the arrival. */
  coast: number;
  /** Search window for arrival, in days after `ut`. */
  fromDay?: number;
  toDay?: number;
}

export interface TransferPlan {
  burnUt: number;
  /** Seconds from the burn to entering the target's sphere of influence. */
  encounterIn: number;
}

export function findTransferBurn(q: TransferSearch): TransferPlan | null {
  const eph = q.model.ephemeris;
  const orbitPeriod = 2 * Math.PI * Math.sqrt(Math.hypot(...q.r) ** 3 / q.mu);
  for (let day = q.fromDay ?? 2; day <= (q.toDay ?? 32); day += 0.2) {
    const arrival = q.ut + day * 86400;
    const m = eph.relative(q.target, arrival).pos;
    const ml = Math.hypot(...m);
    for (let t = 30; t < orbitPeriod; t += orbitPeriod / 180) {
      const s = propagate({ r: q.r, v: q.v }, q.mu, t);
      const dir = -(s.r[0] * m[0] + s.r[1] * m[1] + s.r[2] * m[2]) / (Math.hypot(...s.r) * ml);
      if (dir < 0.95) continue;
      // the burn point is roughly opposite the Moon at arrival: whole orbits later
      const wanted = arrival - q.coast - q.ut;
      const burnUt = q.ut + t + Math.round((wanted - t) / orbitPeriod) * orbitPeriod;
      if (burnUt < q.ut + 30) continue;
      const start = propagate({ r: q.r, v: q.v }, q.mu, burnUt - q.ut - 1);
      const traj = predictTrajectory(q.model, { body: q.body, r: start.r, v: start.v, ut: burnUt - 1 }, [{ id: 1, ut: burnUt, prograde: q.dv, normal: 0, radial: 0 }], { maxPatches: 3, maxOrbits: 2 });
      const moon = traj.patches.find((p) => p.body === q.target);
      if (moon && moon.startUt - burnUt < 7 * 86400) return { burnUt, encounterIn: moon.startUt - burnUt };
    }
  }
  return null;
}

/**
 * Maneuver nodes: a planned impulsive burn at a future time, in the usual prograde / normal / radial frame of the orbit at
 * that moment. Pure maths; the trajectory predictor applies the nodes and the HUD reads the burn from them.
 */
import { cross, length, scale, add, type Vec3 } from '../physics/kepler';
import { G0 } from '../builder/stats';
import type { Vessel } from './vessel';
import { poolKey, poolMasses } from './propulsion';

export interface ManeuverNode {
  id: number;
  /** Universal time of the burn (s). */
  ut: number;
  /** Components of the velocity change (m/s) along prograde, orbit normal and radial-out at the node. */
  prograde: number;
  normal: number;
  radial: number;
}

export interface BurnFrame {
  prograde: Vec3;
  normal: Vec3;
  radial: Vec3;
}

/** Orthonormal burn axes for a body-relative state: prograde along the velocity, normal along r x v, radial out completing the set. */
export function burnFrame(r: Vec3, v: Vec3): BurnFrame {
  const vl = length(v) || 1;
  const prograde = scale(v, 1 / vl);
  let n = cross(r, v);
  const nl = length(n);
  n = nl > 1e-9 ? scale(n, 1 / nl) : [0, 1, 0];
  return { prograde, normal: n, radial: cross(prograde, n) };
}

/** The node's velocity change as a vector (inertial axes) for the state it burns from. */
export function nodeDeltaV(node: Pick<ManeuverNode, 'prograde' | 'normal' | 'radial'>, r: Vec3, v: Vec3): Vec3 {
  const f = burnFrame(r, v);
  return add(add(scale(f.prograde, node.prograde), scale(f.normal, node.normal)), scale(f.radial, node.radial));
}

export const nodeMagnitude = (n: Pick<ManeuverNode, 'prograde' | 'normal' | 'radial'>): number => Math.hypot(n.prograde, n.normal, n.radial);

export interface BurnEstimate {
  /** Thrust of the engines that are lit or will light with the next stage (N) and their mean vacuum Isp (s). */
  thrust: number;
  isp: number;
  /** Delta-v the current stage can still deliver (m/s). */
  stageDeltaV: number;
  /** Seconds a burn of the given size takes, or Infinity if the stage cannot deliver it. */
  burnTime(dv: number): number;
}

/**
 * Estimate what the vessel's engines can do right now: the lit engines, or if none is lit, those of the next stage. The burn
 * uses the propellant those engines can reach (their segment's pools); a burn longer than one stage is not modelled.
 */
export function burnEstimate(v: Vessel): BurnEstimate {
  const lit = v.parts.filter((p) => p.def.engine && p.ignited);
  const engines = lit.length > 0 ? lit : v.parts.filter((p) => p.def.engine && p.stage === v.nextStage);
  let thrust = 0;
  let flow = 0;
  for (const p of engines) {
    const e = p.def.engine!;
    thrust += e.thrustVac;
    flow += e.thrustVac / (e.ispVac * G0);
  }
  const isp = flow > 0 ? thrust / (flow * G0) : 0;
  const pools = poolMasses(v);
  let fuel = 0;
  const seen = new Set<string>();
  for (const p of engines) {
    const key = poolKey(v, p, p.def.engine!.propellant);
    if (seen.has(key)) continue;
    seen.add(key);
    fuel += pools.get(key) ?? 0;
  }
  const m0 = v.mass.mass;
  const ve = isp * G0;
  const stageDeltaV = isp > 0 && fuel > 0 ? ve * Math.log(m0 / Math.max(m0 - fuel, 1)) : 0;
  return {
    thrust,
    isp,
    stageDeltaV,
    burnTime(dv: number) {
      if (thrust <= 0 || dv <= 0) return dv <= 0 ? 0 : Infinity;
      if (dv > stageDeltaV) return Infinity;
      return (m0 * (1 - Math.exp(-dv / ve)) * ve) / thrust;
    },
  };
}

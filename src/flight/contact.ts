/**
 * Ground contact. Each part has a few contact points (the rims of its ends, the feet of landing legs, the tips of fins); a
 * point below the local ground plane is pushed back out by a damped spring and dragged by friction against the (rotating)
 * ground. The plane is fitted through three samples of the terrain height function, so slopes and hills work. Impacts faster
 * than a part's crash tolerance break it. Pure maths.
 */
import { rotate } from '../builder/craft';
import { horizon, surfaceVelocity, type FlightEnv } from './env';
import { vadd, vcross, vdot, vlen, vmad, vnorm, vscale, vsub, qrot, type V3 } from './math3';
import type { FlightPart, Vessel } from './vessel';

const FRICTION = 0.9;
const BRAKED_FRICTION = 1.8;
const STATIC_COMPRESSION = 0.05; // m a resting vessel sinks into its contacts
const NOMINAL_CONTACTS = 8;

export interface ContactResult {
  /** Force (N) and torque about the centre of mass (N m), inertial frame. */
  force: V3;
  torque: V3;
  /** Points currently touching. */
  count: number;
  /** Parts whose impact exceeded their crash tolerance (with the speed). */
  broken: Array<{ id: string; speed: number }>;
  /** Altitude of the lowest contact point above the ground plane. */
  clearance: number;
  /** Force on each part from the ground (inertial frame), for the structural load check. */
  perPart: Map<string, V3>;
}

/** Contact points of a part in the craft frame. */
export function partContactPoints(p: FlightPart): V3[] {
  const d = p.def;
  const h = d.height / 2;
  const at = (x: number, y: number, z: number): V3 => {
    const r = rotate(p, [x, y, z]);
    return [p.pos[0] + r[0], p.pos[1] + r[1], p.pos[2] + r[2]];
  };
  if (d.look === 'leg') {
    const out = d.radius * 1.6 * p.leg;
    return [at(0.05 + out, -h * (0.5 + 0.5 * p.leg) + h * 0.4 * (1 - p.leg), 0)];
  }
  if (d.look === 'fin' || d.look === 'panel') return [at(d.radius * (d.look === 'panel' ? 2 : 1), -h * 0.8, 0), at(d.radius * (d.look === 'panel' ? 2 : 1), h * 0.8, 0)];
  if (d.surface && d.look !== 'solid') return [at(0.1, 0, 0)];
  const r = (d.engine ? 0.9 : 1) * d.radius;
  const pts: V3[] = [at(0, -h, 0), at(r, -h, 0), at(-r, -h, 0), at(0, -h, r), at(0, -h, -r), at(r, h, 0), at(-r, h, 0), at(0, h, r), at(0, h, -r)];
  return pts;
}

/** Fit a plane through the terrain near `pos`: a point on it and the outward normal. */
export function groundPlane(env: FlightEnv, pos: V3, span: number): { point: V3; normal: V3 } {
  const { up, east, north } = horizon(env, pos);
  const sample = (dir: V3): V3 => vscale(vnorm(dir), env.groundRadius(dir));
  const g0 = sample(pos);
  const a = Math.max(span, 3);
  const g1 = sample(vmad(pos, east, a));
  const g2 = sample(vmad(pos, north, a));
  let n = vnorm(vcross(vsub(g1, g0), vsub(g2, g0)));
  if (vdot(n, up) < 0) n = vscale(n, -1);
  if (vlen(n) === 0) n = up;
  return { point: g0, normal: n };
}

/** Rough size of the vessel (m): the farthest part from its centre of mass plus its extent. */
export function vesselExtent(v: Vessel): number {
  let m = 0;
  for (const p of v.parts) m = Math.max(m, Math.hypot(p.pos[0] - v.mass.com[0], p.pos[1] - v.mass.com[1], p.pos[2] - v.mass.com[2]) + p.def.height / 2 + p.def.radius);
  return m;
}

export function contactForces(v: Vessel, env: FlightEnv, gravity: number, dt: number): ContactResult {
  const out: ContactResult = { force: [0, 0, 0], torque: [0, 0, 0], count: 0, broken: [], clearance: Infinity, perPart: new Map() };
  const extent = vesselExtent(v);
  const plane = groundPlane(env, v.pos, extent);
  const comClear = vdot(vsub(v.pos, plane.point), plane.normal);
  if (comClear > extent + 5) {
    v.touching.clear();
    out.clearance = comClear - extent;
    return out;
  }
  const M = v.mass.mass;
  const k = (M * gravity) / (NOMINAL_CONTACTS * STATIC_COMPRESSION);
  const c = 2 * 0.6 * Math.sqrt((k * M) / NOMINAL_CONTACTS);
  // Friction is capped by a viscous gain small enough that one step cannot reverse the sliding velocity (otherwise a spinning
  // or sliding vessel chatters back and forth between full friction in each direction).
  const inertiaMin = Math.max(Math.min(v.mass.inertia[0], v.mass.inertia[4], v.mass.inertia[8]), 1e-3);
  const viscous = 0.4 / (dt * (1 / M + (extent * extent) / inertiaMin));
  const wWorld = qrot(v.q, v.w);
  const touchingNow = new Set<string>();

  for (const p of v.parts) {
    for (const local of partContactPoints(p)) {
      const rel = qrot(v.q, vsub(local, v.mass.com));
      const world = vadd(v.pos, rel);
      const depth = -vdot(vsub(world, plane.point), plane.normal); // > 0 below the ground
      out.clearance = Math.min(out.clearance, -depth);
      if (depth <= 0) continue;
      const pv = vadd(v.vel, vcross(wWorld, rel));
      const vr = vsub(pv, surfaceVelocity(env, world));
      const vn = vdot(vr, plane.normal);
      if (!v.touching.has(p.id) && vn < -p.def.crashTolerance && !out.broken.some((b) => b.id === p.id)) out.broken.push({ id: p.id, speed: -vn });
      touchingNow.add(p.id);
      const d = Math.min(depth, 3);
      const normalForce = Math.max(0, k * d - c * vn);
      const vt = vsub(vr, vscale(plane.normal, vn));
      const speed = vlen(vt);
      const mu = v.brakes ? BRAKED_FRICTION : FRICTION;
      const friction = speed > 1e-9 ? vscale(vt, -Math.min(mu * normalForce, viscous * (v.brakes ? 2 : 1) * speed) / speed) : ([0, 0, 0] as V3);
      const f = vadd(vscale(plane.normal, normalForce), friction);
      out.force = vadd(out.force, f);
      out.perPart.set(p.id, vadd(out.perPart.get(p.id) ?? [0, 0, 0], f));
      out.torque = vadd(out.torque, vcross(rel, f));
      out.count++;
    }
  }
  v.touching = touchingNow;
  return out;
}

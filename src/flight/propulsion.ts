/**
 * Engines and fuel. An ignited engine pushes along its axis with thrust and Isp interpolated between sea level and vacuum by
 * ambient pressure, and draws propellant from the tanks in its segment (everything connected to it without crossing a
 * decoupler) that hold its propellant. Gimbal deflects the thrust: because the engine sits away from the centre of mass, that
 * is what steers the rocket. Pure maths.
 */
import { engineAt, G0 } from '../builder/stats';
import { thrustAxis, type FlightPart, type Vessel } from './vessel';
import { clamp, vcross, vnorm, vsub, type V3 } from './math3';

export interface PropulsionResult {
  force: V3;
  torque: V3;
  /** Number of engines producing thrust, and total thrust (N). */
  firing: number;
  thrust: number;
  /** Thrust force on each engine part (body frame). */
  perPart: Map<string, V3>;
}

export const poolKey = (v: Vessel, p: FlightPart, kind: string): string => `${v.segment.get(p.id) ?? -1}|${kind}`;

/** Propellant (kg) left in each pool of the vessel. */
export function poolMasses(v: Vessel): Map<string, number> {
  const pools = new Map<string, number>();
  for (const p of v.parts) {
    if (!p.def.propellant) continue;
    const k = poolKey(v, p, p.def.propellant.kind);
    pools.set(k, (pools.get(k) ?? 0) + p.fuel);
  }
  return pools;
}

/** Take `amount` kg out of a pool, spread over its tanks in proportion to what each holds. */
function drain(v: Vessel, key: string, amount: number): void {
  const tanks = v.parts.filter((p) => p.def.propellant && poolKey(v, p, p.def.propellant.kind) === key && p.fuel > 0);
  const total = tanks.reduce((s, t) => s + t.fuel, 0);
  if (total <= 0) return;
  for (const t of tanks) t.fuel = Math.max(0, t.fuel - amount * (t.fuel / total));
}

/** Ambient pressure as a fraction of sea-level (0 = vacuum, 1 = sea level; above 1 it is clamped). */
export const pressureRatio = (pressure: number): number => clamp(pressure / 101325, 0, 1);

/**
 * One physics step of propulsion. Fuel is consumed here, so `dt` matters. `gimbal` is the pitch/yaw request (-1..1).
 */
export function propulsion(v: Vessel, ratio: number, dt: number, gimbal: { pitch: number; yaw: number }): PropulsionResult {
  const force: V3 = [0, 0, 0];
  const torque: V3 = [0, 0, 0];
  const perPart = new Map<string, V3>();
  let firing = 0;
  let thrustTotal = 0;
  for (const p of v.parts) p.burn = 0;
  const pools = poolMasses(v);
  const demand = new Map<string, number>();
  const live: Array<{ p: FlightPart; thrust: number; mdot: number; key: string }> = [];

  for (const p of v.parts) {
    const e = p.def.engine;
    if (!e || !p.ignited) continue;
    const throttle = e.minThrottle >= 1 ? 1 : v.throttle <= 0 ? 0 : Math.max(e.minThrottle, v.throttle);
    if (throttle <= 0) continue;
    const key = poolKey(v, p, e.propellant);
    if ((pools.get(key) ?? 0) <= 1e-6) {
      if (p.def.look === 'solid' || p.def.engine?.minThrottle === 1) p.ignited = false; // a spent motor stays dead
      continue;
    }
    if (e.electric !== undefined && v.charge <= 0) continue;
    const { thrust, isp } = engineAt(e, ratio);
    const t = thrust * throttle;
    const mdot = t / (isp * G0);
    live.push({ p, thrust: t, mdot, key });
    demand.set(key, (demand.get(key) ?? 0) + mdot * dt);
  }

  // If a pool cannot supply a full step, every engine on it gets a proportionally smaller share of it.
  const satisfied = new Map<string, number>();
  for (const [key, need] of demand) satisfied.set(key, need > 0 ? Math.min(1, (pools.get(key) ?? 0) / need) : 1);

  for (const { p, thrust, mdot, key } of live) {
    const share = satisfied.get(key) ?? 1;
    const f = thrust * share;
    if (f <= 0) continue;
    const e = p.def.engine!;
    const r = vsub(p.pos, v.mass.com);
    const axis = thrustAxis(p);
    // Gimbal: push the thrust sideways on the side that makes the torque the pilot asked for (engine below the centre of mass:
    // thrust pushed towards -X tips the nose towards +X).
    const gimbalLimit = Math.tan((e.gimbal * Math.PI) / 180);
    const sy = Math.abs(r[1]) < 0.05 ? 0 : Math.sign(r[1]);
    const dir = gimbalLimit > 0 && sy !== 0 ? vnorm([axis[0] + gimbalLimit * sy * gimbal.pitch, axis[1], axis[2] + gimbalLimit * sy * gimbal.yaw]) : axis;
    const fv: V3 = [dir[0] * f, dir[1] * f, dir[2] * f];
    force[0] += fv[0];
    force[1] += fv[1];
    force[2] += fv[2];
    const t = vcross(r, fv);
    torque[0] += t[0];
    torque[1] += t[1];
    torque[2] += t[2];
    perPart.set(p.id, fv);
    p.burn = Math.min(1, f / Math.max(1, engineAt(e, ratio).thrust));
    firing++;
    thrustTotal += f;
    drain(v, key, mdot * dt * share);
    if (e.electric !== undefined) v.charge = Math.max(0, v.charge - e.electric * dt * (f / Math.max(e.thrustVac, 1)));
  }
  return { force, torque, firing, thrust: thrustTotal, perPart };
}

/**
 * Torque available (N m) about the body axes [X, Y, Z] from reaction wheels, RCS and engine gimbal at the current throttle and
 * ambient pressure. Gimbal only tips the nose (X and Z); roll comes from wheels, RCS and fins.
 */
export function controlAuthority(v: Vessel, ratio: number, rcs: boolean): V3 {
  let wheels = 0;
  let rcsTorque = 0;
  for (const p of v.parts) {
    if (p.def.torque) wheels += p.def.torque * 1000;
    if (rcs && p.def.rcsThrust) rcsTorque += p.def.rcsThrust * Math.max(Math.hypot(p.pos[0] - v.mass.com[0], p.pos[2] - v.mass.com[2]), 0.3);
  }
  let gimbal = 0;
  for (const p of v.parts) {
    const e = p.def.engine;
    if (!e || !p.ignited || e.gimbal <= 0 || v.throttle <= 0) continue;
    const thrust = engineAt(e, ratio).thrust * (e.minThrottle >= 1 ? 1 : v.throttle);
    gimbal += thrust * Math.sin((e.gimbal * Math.PI) / 180) * Math.abs(p.pos[1] - v.mass.com[1]);
  }
  const tip = wheels + rcsTorque + gimbal;
  return [tip, wheels + rcsTorque, tip];
}

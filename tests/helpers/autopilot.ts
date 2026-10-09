import type { FlightWorld } from '../../src/flight/flight-world';
import { altitudeOf, surfaceVelocity } from '../../src/flight/env';
import { orbitInfo } from '../../src/flight/orbit-info';
import { clamp, qrot, vdot, vlen, vnorm, vsub } from '../../src/flight/math3';
import type { Vessel } from '../../src/flight/vessel';

export interface AscentLog {
  t: number;
  phase: string;
  alt: number;
  speed: number;
  apo: number;
  peri: number;
  q: number;
  stress: number;
  pitch: number;
}

export interface AscentOptions {
  /** Target orbit altitude (m). */
  target: number;
  /** Altitude (m) where the pitch-over begins. */
  kickAlt?: number;
  maxSeconds?: number;
  /** Altitude-hold trim above the atmosphere: pitch (deg) = base + kp (m) * (target - alt) - kv * vertical speed. */
  trim?: { base: number; kp: number; kv: number };
}

/**
 * A scripted launch using only what a player has: stage, throttle, pitch input and SAS. Vertical rise, a short pitch kick
 * towards +X (east), a SAS-prograde gravity turn, staging at burnout, coast to apoapsis, and a circularising burn.
 */
export function flyAscent(world: FlightWorld, v: Vessel, o: AscentOptions): { phase: string; log: AscentLog[]; v: Vessel } {
  const dt = 1 / 120;
  const log: AscentLog[] = [];
  const kickAlt = o.kickAlt ?? 300;
  let phase = 'pad';
  v.throttle = 1;
  v.sas.enabled = true;
  v.sas.mode = 'stability';
  world.stage();
  const mu = world.env.mu;
  const maxT = o.maxSeconds ?? 2400;
  for (let t = 0; t < maxT; t += dt) {
    world.step(dt);
    const a = world.active ?? v;
    if (!world.active) return { phase: 'lost', log, v: a };
    const alt = altitudeOf(world.env, a.pos);
    const rel = vsub(a.vel, surfaceVelocity(world.env, a.pos));
    const speed = vlen(rel);
    const orb = orbitInfo(a.pos, a.vel, mu, world.env.radius);

    if (phase === 'pad' && a.situation === 'flying') phase = 'climb';
    if (phase === 'climb' && alt > kickAlt) phase = 'turn';
    if (phase === 'turn') {
      // Pitch program through the atmosphere; above it, fly nearly level and trim vertical speed to hold the target altitude.
      const up = vnorm(a.pos);
      const vz = vdot(a.vel, up);
      const target = alt < 55_000 ? pitchProgram(alt) : clamp((o.trim?.base ?? 6) + (o.trim?.kp ?? 0.0008) * (o.target - alt) - (o.trim?.kv ?? 0.05) * vz, -18, 25);
      const nose = qrot(a.q, [0, 1, 0]);
      const elevation = Math.asin(clamp(vdot(nose, up), -1, 1));
      const rate = -a.w[2]; // nose moving towards body +X
      a.controls.pitch = clamp(3 * (elevation - (target * Math.PI) / 180) - 2.2 * rate, -1, 1);
      // Insertion: throttle back as horizontal speed approaches circular speed, and cut when it gets there.
      const horizontal = vlen(vsub(a.vel, [up[0] * vz, up[1] * vz, up[2] * vz]));
      const circular = Math.sqrt(mu / vlen(a.pos));
      if (alt > 70_000) a.throttle = clamp((circular - horizontal) / 150, 0.08, 1);
      if (alt > 70_000 && (orb.periapsis > o.target - 15_000 || horizontal > circular + 25)) {
        a.throttle = 0;
        a.controls.pitch = 0;
        phase = 'orbit';
        log.push({ t, phase, alt, speed, apo: orb.apoapsis, peri: orb.periapsis, q: a.tele.q, stress: a.tele.stress, pitch: 0 });
        return { phase, log, v: a };
      }
    }
    if (phase === 'turn' && alt < 70_000) {
      // ease off through max-Q, as a player would
      a.throttle = clamp(1 - (a.tele.q - 28_000) / 22_000, 0.45, 1);
    }
    if (phase === 'turn') {
      // stage when the lit engines have run dry
      const dry = a.tele.thrust === 0 && a.situation === 'flying' && a.throttle > 0 && a.nextStage < 99;
      if (dry && a.parts.some((p) => p.stage >= a.nextStage)) {
        world.stage();
      }
    }
    if (Math.round(t * 120) % 1200 === 0) log.push({ t, phase, alt, speed, apo: orb.apoapsis, peri: orb.periapsis, q: a.tele.q, stress: a.tele.stress, pitch: 0 });
    if (a.situation === 'rest' && t > 20) return { phase: 'landed', log, v: a };
  }
  return { phase: 'timeout:' + phase, log, v: world.active ?? v };
}

/** Target elevation angle (degrees above the horizon) of the nose against altitude: a typical gravity-turn program. */
export function pitchProgram(alt: number): number {
  const pts: Array<[number, number]> = [[300, 90], [2_000, 80], [10_000, 58], [25_000, 38], [45_000, 20], [70_000, 8], [1e6, 3]];
  for (let i = 1; i < pts.length; i++) {
    if (alt <= pts[i]![0]) {
      const [a0, p0] = pts[i - 1]!;
      const [a1, p1] = pts[i]!;
      return p0 + ((p1 - p0) * (alt - a0)) / (a1 - a0);
    }
  }
  return 3;
}

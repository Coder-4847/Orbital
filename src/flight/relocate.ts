/**
 * Cheat-menu moves: put the active vessel in orbit around any body, on the ground anywhere on a rocky body, or jump the
 * universal time. Each returns an error message for the player, or null when it worked. Pure maths over the flight world.
 */
import { bodyDef } from '../data/solar-system';
import type { FlightWorld } from './flight-world';
import { altitudeOf } from './env';
import { qfromBasis, vcross, vnorm, vscale, type V3 } from './math3';
import type { Navigator } from './navigator';

const DAY = 86400;

/** Direction (body-fixed, unit) of a latitude and longitude in degrees: +Y north pole, +X at longitude 0, east towards -Z. */
export function surfaceDirection(latDeg: number, lonDeg: number): V3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)];
}

/** A circular equatorial orbit at `altitude` metres above the body, nose along the direction of travel. */
export function teleportToOrbit(world: FlightWorld, bodyId: string, altitude: number): string | null {
  const v = world.active;
  if (!v) return 'There is no vessel to move.';
  if (!world.host) return 'Moving between bodies needs the full solar system.';
  v.situation = 'flying';
  v.touching.clear();
  world.vessels = [v];
  if (bodyId !== world.bodyId) world.switchBody(bodyId);
  const env = world.env;
  const floor = env.railsFloor ?? 15_000;
  const alt = Math.max(altitude, floor + 1000);
  const r = env.radius + alt;
  const side = vnorm(vcross(env.spinAxis, Math.abs(env.spinAxis[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]));
  const up = side;
  const forward = vnorm(vcross(env.spinAxis, up));
  v.pos = vscale(up, r);
  v.vel = vscale(forward, Math.sqrt(env.mu / r));
  v.q = qfromBasis(up, forward, vcross(up, forward));
  v.w = [0, 0, 0];
  v.throttle = 0;
  world.version++;
  return null;
}

/** Stand the vessel on the ground at a latitude and longitude. Bodies without a surface (the Sun, gas giants) refuse. */
export function teleportToSurface(world: FlightWorld, bodyId: string, latDeg: number, lonDeg: number): string | null {
  const v = world.active;
  if (!v) return 'There is no vessel to move.';
  const def = bodyDef(bodyId);
  if (def.render !== 'terrain') return `${def.name} has no surface to land on.`;
  v.situation = 'flying';
  v.touching.clear();
  world.vessels = [v];
  if (bodyId !== world.bodyId) {
    if (!world.host) return 'Moving between bodies needs the full solar system.';
    world.switchBody(bodyId);
  }
  world.setOnSurface(v, { direction: surfaceDirection(latDeg, lonDeg), headingDeg: 90 });
  return null;
}

/**
 * Move universal time to `ut`. A landed vessel just waits (the planet turns under it); a vessel in orbit follows its orbit,
 * crossing spheres of influence on the way, and stops early if it would reach the air. Backwards jumps stay in the same orbit.
 */
export function jumpToTime(world: FlightWorld, nav: Navigator, ut: number): string | null {
  const delta = ut - world.ut;
  if (!Number.isFinite(delta)) return 'That is not a date.';
  if (Math.abs(delta) < 1) return null;
  const v = world.active;
  if (!v || v.situation === 'rest') {
    world.railsMove(delta);
    world.version++;
    return null;
  }
  if (v.tele.thrust > 0) return 'Cut the engines before jumping in time.';
  const floor = world.env.railsFloor ?? 15_000;
  if (altitudeOf(world.env, v.pos) < floor) return 'Too low to skip time: get above the atmosphere first.';
  if (delta < 0) {
    const before = world.ut;
    world.railsMove(delta);
    world.version++;
    if (altitudeOf(world.env, world.active?.pos ?? v.pos) < floor) {
      world.railsMove(before - world.ut);
      world.version++;
      return 'That orbit would be inside the atmosphere at that time.';
    }
    return null;
  }
  let remaining = delta;
  while (remaining > 1) {
    const hop = Math.min(remaining, 20 * DAY);
    const before = world.ut;
    const result = nav.advanceRails(hop, 0);
    remaining -= world.ut - before;
    if (result.stopped) return 'Stopped early: the orbit reaches the atmosphere or the ground.';
    if (!world.active) return 'The vessel was lost.';
  }
  world.version++;
  return null;
}


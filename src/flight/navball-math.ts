/**
 * Navball geometry. The ball is seen from the nose: screen right is body +X, screen up is body -Z, and the point facing the viewer
 * is the nose (body +Y). A direction in the world appears where it falls on that sphere; the ball's sky/ground and compass
 * come from the local horizon (up, east, north). Pure maths.
 */
import { qrot, qrotInv, vdot, type Quat, type V3 } from './math3';

/** Body-frame direction of the ball's surface point at screen (x, y) in the unit disc (x right, y up). */
export const ballPointToBody = (x: number, y: number): V3 => [x, Math.sqrt(Math.max(0, 1 - x * x - y * y)), -y];

/** Where a world direction appears on the ball: screen x/y in the unit disc, and whether it is on the visible hemisphere. */
export function project(q: Quat, dir: V3): { x: number; y: number; front: boolean } {
  const b = qrotInv(q, dir);
  return { x: b[0], y: -b[2], front: b[1] > 0 };
}

export interface HorizonFrame {
  up: V3;
  east: V3;
  north: V3;
}

/** Elevation (radians above the horizon) and compass bearing (radians clockwise from north) of a world direction. */
export function elevationAndBearing(h: HorizonFrame, dir: V3): { elevation: number; bearing: number } {
  const u = vdot(dir, h.up);
  const e = vdot(dir, h.east);
  const n = vdot(dir, h.north);
  return { elevation: Math.asin(Math.max(-1, Math.min(1, u))), bearing: (Math.atan2(e, n) + Math.PI * 2) % (Math.PI * 2) };
}

/** Pitch, heading and roll of a vessel for the readouts: pitch is the nose's elevation, heading its bearing, roll about the nose. */
export function attitude(q: Quat, h: HorizonFrame): { pitch: number; heading: number; roll: number } {
  const nose = qrot(q, [0, 1, 0]);
  const { elevation, bearing } = elevationAndBearing(h, nose);
  // Roll: where the body "top" (-Z) points relative to the horizon's up projected perpendicular to the nose.
  const top = qrot(q, [0, 0, -1]);
  const right = qrot(q, [1, 0, 0]);
  const upPerp: V3 = [h.up[0] - nose[0] * vdot(h.up, nose), h.up[1] - nose[1] * vdot(h.up, nose), h.up[2] - nose[2] * vdot(h.up, nose)];
  const roll = Math.abs(elevation) > 1.5 ? 0 : Math.atan2(vdot(upPerp, right), vdot(upPerp, top));
  return { pitch: elevation, heading: bearing, roll };
}

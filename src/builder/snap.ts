/**
 * Snapping: given where the player is pointing, find which attachment node a part being placed should join, or where on a
 * parent's side it should be mounted. Pure maths on the craft model.
 */
import { attachInstance, freeNodes, getPart, partNodes, type Craft, type V3 } from './craft';
import type { Placement } from './edit';
import { partDef } from './part-library';

export interface Ray {
  origin: V3;
  dir: V3;
}

/** Distance from a point to a ray (the ray starts at `origin` and runs forwards). */
export function distanceToRay(p: V3, ray: Ray): number {
  const dx = p[0] - ray.origin[0];
  const dy = p[1] - ray.origin[1];
  const dz = p[2] - ray.origin[2];
  const t = Math.max(0, dx * ray.dir[0] + dy * ray.dir[1] + dz * ray.dir[2]);
  const ex = dx - ray.dir[0] * t;
  const ey = dy - ray.dir[1] * t;
  const ez = dz - ray.dir[2] * t;
  return Math.hypot(ex, ey, ez);
}

/**
 * The free node nearest the ray, with the part's own node that fits it best, as a ready-made placement. `flipped` asks for the
 * part's other end to be used (an upside-down engine, say) when both ends fit.
 */
export function findStackSnap(c: Craft, defId: string, ray: Ray, maxDistance: number, flipped = false): (Placement & { kind: 'stack'; distance: number }) | null {
  const def = partDef(defId);
  const own = partNodes(def);
  let best: (Placement & { kind: 'stack'; distance: number }) | null = null;
  for (const node of freeNodes(c)) {
    const distance = distanceToRay(node.pos, ray);
    if (distance > maxDistance || (best && distance >= best.distance)) continue;
    // Prefer the own node that faces the opposite way (no flip needed); `flipped` swaps the preference.
    const candidates = own.filter((o) => attachInstance(c, defId, node, o.id) !== null);
    if (candidates.length === 0) continue;
    const natural = candidates.find((o) => Math.sign(o.dir[1]) === -Math.sign(node.dir[1]) || (o.dir[1] === 0 && node.dir[1] === 0));
    const other = candidates.find((o) => o !== natural);
    const chosen = flipped ? (other ?? natural) : (natural ?? other);
    if (!chosen) continue;
    best = { kind: 'stack', def: defId, target: { partId: node.partId, nodeId: node.nodeId }, ownNode: chosen.id, distance };
  }
  return best;
}

const HEIGHT_GRID = 0.05;

/** Side placement from a raycast hit on `parentId`: the angle round its axis and a grid-snapped height. */
export function surfaceFromHit(c: Craft, defId: string, parentId: string, hit: V3): (Placement & { kind: 'surface' }) | null {
  const parent = getPart(c, parentId);
  if (!parent || !partDef(defId).surface || !partDef(parent.def).hostsSurface) return null;
  const theta = Math.atan2(hit[2] - parent.pos[2], hit[0] - parent.pos[0]);
  const y = Math.round(hit[1] / HEIGHT_GRID) * HEIGHT_GRID;
  return { kind: 'surface', def: defId, parentId, theta, y };
}

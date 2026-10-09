/**
 * Structural loads. A joint carries whatever the parts beyond it (away from the vessel's root) are not carrying for
 * themselves: the external forces on them (thrust, air) minus the inertial forces of their acceleration. Axial load,
 * shear and bending moment are compared with the joint's strength, which grows with the size of the joint. A joint that is
 * overloaded fails and the parts beyond it break away. This is what makes a rocket that tumbles at high speed fold in half.
 * Pure maths.
 */
import { nodeById, rotate } from '../builder/craft';
import { vadd, vcross, vscale, vsub, type V3 } from './math3';
import type { FlightPart, Vessel } from './vessel';

const AXIAL = 1.5e6; // N per m^2 of joint area (size squared)
const SHEAR = 1.0e6;
const BENDING = 4.0e5; // N m per m^3
/** Side-mounted joints (radial decouplers, struts) are built much stronger than their size suggests. */
const RADIAL_FACTOR = 8;

export interface JointLoad {
  partId: string;
  /** Load as a fraction of the joint's strength (1 = about to fail). */
  ratio: number;
}

/** Where and how big the joint between `child` and its tree parent is. */
function jointGeometry(child: FlightPart, parent: FlightPart): { point: V3; size: number; radial: boolean } {
  const owner = child.link.parent === parent.id ? child : parent;
  const nodeId = owner === child ? child.link.node : owner.link.node;
  const node = nodeId ? nodeById(owner.def, nodeId) : undefined;
  if (!node) return { point: vscale(vadd(child.pos, parent.pos), 0.5), size: 1, radial: false };
  const r = rotate(owner, node.pos);
  const radial = nodeId === 'surface' || nodeId === 'outer';
  return { point: [owner.pos[0] + r[0], owner.pos[1] + r[1], owner.pos[2] + r[2]], size: Math.max(node.size, radial ? 1 : 0.6), radial };
}

/**
 * Check every joint. `external` is the force on each part (body frame, non-gravitational); `accel` the vessel's
 * non-gravitational acceleration of the centre of mass; `alpha` and `w` its angular acceleration and velocity (body frame).
 */
export function jointLoads(v: Vessel, external: Map<string, V3>, accel: V3, alpha: V3, w: V3): JointLoad[] {
  const byId = new Map(v.parts.map((p) => [p.id, p]));
  const com = v.mass.com;
  const net = new Map<string, V3>(); // force imbalance on each part
  const moment = new Map<string, V3>(); // r x F about the centre of mass
  for (const p of v.parts) {
    const m = p.dry + p.fuel;
    const r = vsub(p.pos, com);
    const a = vadd(vadd(accel, vcross(alpha, r)), vcross(w, vcross(w, r)));
    const f = external.get(p.id) ?? [0, 0, 0];
    const fn: V3 = [f[0] - m * a[0], f[1] - m * a[1], f[2] - m * a[2]];
    net.set(p.id, fn);
    moment.set(p.id, vcross(r, fn));
  }
  // Sum up the subtrees, leaves first.
  const sumF = new Map(net);
  const sumM = new Map(moment);
  const out: JointLoad[] = [];
  const parentOf = new Map<string, string>();
  for (const [id, kids] of v.children) for (const k of kids) parentOf.set(k, id);
  for (let i = v.order.length - 1; i >= 0; i--) {
    const id = v.order[i]!;
    const par = parentOf.get(id);
    if (!par) continue;
    const child = byId.get(id)!;
    const f = sumF.get(id)!;
    const mom = sumM.get(id)!;
    const geo = jointGeometry(child, byId.get(par)!);
    const j = vsub(geo.point, com);
    const mj = vsub(mom, vcross(j, f)); // moment of the subtree about the joint
    const k = geo.radial ? RADIAL_FACTOR : 1;
    const axial = Math.abs(f[1]) / (AXIAL * geo.size * geo.size * k);
    const shear = Math.hypot(f[0], f[2]) / (SHEAR * geo.size * geo.size * k);
    const bending = Math.hypot(mj[0], mj[2]) / (BENDING * geo.size ** 3 * k);
    out.push({ partId: id, ratio: Math.max(axial, shear, bending) });
    sumF.set(par, vadd(sumF.get(par)!, f));
    sumM.set(par, vadd(sumM.get(par)!, mom));
  }
  return out;
}


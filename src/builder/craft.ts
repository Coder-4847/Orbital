/**
 * The craft model: a tree of part instances with positions in the craft frame (metres, +Y up). Parts only ever rotate about
 * the vertical axis (`yaw`) and may be flipped upside down (`flip`, a half turn about X), which keeps the data tiny and the
 * maths exact. Pure data and maths: no rendering imports.
 */
import { partDef } from './part-library';
import type { PartDef } from './part-types';

export type V3 = [number, number, number];

export interface PartInstance {
  id: string;
  def: string;
  /** Position of the part's origin in the craft frame. */
  pos: V3;
  yaw: number;
  flip: boolean;
  /** What this part is attached to: the parent part and the node on each side ("surface" for side attachment). */
  parent: string | null;
  parentNode: string | null;
  node: string | null;
  /** Activation stage (0 = fires first), or -1 when the part is not staged. */
  stage: number;
  /** Shared by the copies made by symmetry, so they are edited together. */
  sym: number | null;
  /** Fraction of propellant loaded (0..1). */
  fill: number;
}

export const CRAFT_FORMAT = 'orbital-craft';
export const CRAFT_VERSION = 1;

export interface Craft {
  format: typeof CRAFT_FORMAT;
  version: number;
  name: string;
  rootId: string | null;
  nextId: number;
  nextSym: number;
  /** When false, staging is recomputed automatically after every edit. */
  manualStaging: boolean;
  parts: PartInstance[];
}

export function newCraft(name = 'Untitled craft'): Craft {
  return { format: CRAFT_FORMAT, version: CRAFT_VERSION, name, rootId: null, nextId: 1, nextSym: 1, manualStaging: false, parts: [] };
}

export const cloneCraft = (c: Craft): Craft => JSON.parse(JSON.stringify(c)) as Craft;

export const getPart = (c: Craft, id: string): PartInstance | undefined => c.parts.find((p) => p.id === id);

// ---------------------------------------------------------------- rotation and nodes

/** Rotate a local vector into the craft frame: flip (half turn about X), then yaw about Y. */
export function rotate(inst: { yaw: number; flip: boolean }, v: V3): V3 {
  const x = v[0];
  const y = inst.flip ? -v[1] : v[1];
  const z = inst.flip ? -v[2] : v[2];
  const c = Math.cos(inst.yaw);
  const s = Math.sin(inst.yaw);
  return [x * c + z * s, y, -x * s + z * c];
}

export interface NodeSpec {
  id: string;
  /** Position and outward direction in the part's local frame. */
  pos: V3;
  dir: V3;
  /** Diameter (m) for stack nodes; 0 for side nodes that fit anything. */
  size: number;
}

/** Distance a side-attached part stands off the parent's surface (round parts are centred on their own axis). */
export const surfaceStandoff = (d: PartDef): number => (d.look === 'solid' ? d.radius : 0);

/** How far a radial decoupler reaches out from the parent's surface (the booster hangs on its outer end). */
export const RADIAL_DECOUPLER_LENGTH = 0.5;

export function partNodes(d: PartDef): NodeSpec[] {
  const out: NodeSpec[] = [];
  if (d.topSize !== undefined) out.push({ id: 'top', pos: [0, d.height / 2, 0], dir: [0, 1, 0], size: d.topSize });
  if (d.bottomSize !== undefined) out.push({ id: 'bottom', pos: [0, -d.height / 2, 0], dir: [0, -1, 0], size: d.bottomSize });
  if (d.surface) out.push({ id: 'surface', pos: [-surfaceStandoff(d), 0, 0], dir: [-1, 0, 0], size: 0 });
  if (d.id === 'dec-radial') out.push({ id: 'outer', pos: [RADIAL_DECOUPLER_LENGTH, 0, 0], dir: [1, 0, 0], size: 1.25 });
  return out;
}

export interface WorldNode {
  partId: string;
  nodeId: string;
  pos: V3;
  dir: V3;
  size: number;
}

export function worldNode(inst: PartInstance, node: NodeSpec): WorldNode {
  const r = rotate(inst, node.pos);
  return { partId: inst.id, nodeId: node.id, pos: [inst.pos[0] + r[0], inst.pos[1] + r[1], inst.pos[2] + r[2]], dir: rotate(inst, node.dir), size: node.size };
}

export const nodeById = (d: PartDef, id: string): NodeSpec | undefined => partNodes(d).find((n) => n.id === id);

/** Keys of nodes that already have something attached ("partId:nodeId"). Side attachment ("surface") is never exclusive. */
export function occupiedNodes(c: Craft): Set<string> {
  const used = new Set<string>();
  for (const p of c.parts) {
    if (!p.parent) continue;
    if (p.parentNode && p.parentNode !== 'surface') used.add(`${p.parent}:${p.parentNode}`);
    if (p.node && p.node !== 'surface') used.add(`${p.id}:${p.node}`);
  }
  return used;
}

/** Every attachment node in the craft that has nothing on it. */
export function freeNodes(c: Craft): WorldNode[] {
  const used = occupiedNodes(c);
  const out: WorldNode[] = [];
  for (const p of c.parts) {
    for (const n of partNodes(partDef(p.def))) {
      if (n.id === 'surface') continue; // a part's own back side is only used when it is the attaching part
      if (!used.has(`${p.id}:${n.id}`)) out.push(worldNode(p, n));
    }
  }
  return out;
}

const SIZE_TOLERANCE = 0.01;
export const sizesFit = (a: number, b: number): boolean => a === 0 || b === 0 || Math.abs(a - b) < SIZE_TOLERANCE;
const vertical = (d: V3): boolean => Math.abs(d[1]) > 0.5;

/**
 * Build the instance for `defId` attached by its node `ownNode` to `target` (a free node). Returns null if the nodes cannot
 * join (different sizes, or a vertical node against a horizontal one). The part inherits the parent's yaw when stacked.
 */
export function attachInstance(c: Craft, defId: string, target: { partId: string; nodeId: string }, ownNode: string): PartInstance | null {
  const parent = getPart(c, target.partId);
  if (!parent) return null;
  const tNode = nodeById(partDef(parent.def), target.nodeId);
  const def = partDef(defId);
  const oNode = nodeById(def, ownNode);
  if (!tNode || !oNode) return null;
  if (target.nodeId !== 'surface' && occupiedNodes(c).has(`${target.partId}:${target.nodeId}`)) return null;
  const tw = worldNode(parent, tNode);
  if (!sizesFit(tw.size, oNode.size) || vertical(tw.dir) !== vertical(oNode.dir)) return null;

  let yaw = parent.yaw;
  let flip = false;
  if (vertical(tw.dir)) {
    flip = oNode.dir[1] !== -Math.sign(tw.dir[1]);
  } else {
    yaw = Math.atan2(-tw.dir[2], tw.dir[0]);
  }
  const probe = { yaw, flip };
  const r = rotate(probe, oNode.pos);
  return {
    id: '',
    def: defId,
    pos: [tw.pos[0] - r[0], tw.pos[1] - r[1], tw.pos[2] - r[2]],
    yaw,
    flip,
    parent: parent.id,
    parentNode: target.nodeId,
    node: ownNode,
    stage: -1,
    sym: null,
    fill: 1,
  };
}

/** Radius of a (possibly tapered) part at height `y` in the craft frame. */
export function radiusAt(inst: PartInstance, y: number): number {
  const d = partDef(inst.def);
  if (d.radiusTop === undefined || d.radiusBottom === undefined) return d.radius;
  const t = Math.min(Math.max((y - (inst.pos[1] - d.height / 2)) / d.height, 0), 1);
  const [top, bottom] = inst.flip ? [d.radiusBottom, d.radiusTop] : [d.radiusTop, d.radiusBottom];
  return bottom + (top - bottom) * t;
}

/** Instance attached to the side of `parent` at angle `theta` (radians about its axis) and height `y`. */
export function surfaceInstance(c: Craft, defId: string, parentId: string, theta: number, y: number): PartInstance | null {
  const parent = getPart(c, parentId);
  const d = partDef(defId);
  if (!parent || !d.surface || !partDef(parent.def).hostsSurface) return null;
  const r = radiusAt(parent, y) + surfaceStandoff(d);
  return {
    id: '',
    def: defId,
    pos: [parent.pos[0] + Math.cos(theta) * r, y, parent.pos[2] + Math.sin(theta) * r],
    yaw: 0 - theta, // (0 - x keeps +0 for theta = 0, so saved files compare equal)
    flip: false,
    parent: parentId,
    parentNode: 'surface',
    node: 'surface',
    stage: -1,
    sym: null,
    fill: 1,
  };
}

/** Add an instance, giving it an id. The first part becomes the root. */
export function addInstance(c: Craft, inst: PartInstance): PartInstance {
  // `+ 0` turns -0 into 0, so a craft compares equal to its own JSON round trip.
  const added = { ...inst, id: `p${c.nextId++}`, yaw: inst.yaw + 0, pos: inst.pos.map((v) => v + 0) as V3 };
  c.parts.push(added);
  if (c.rootId === null) c.rootId = added.id;
  return added;
}

/** Place the very first part at the origin. */
export function rootInstance(defId: string): PartInstance {
  return { id: '', def: defId, pos: [0, partDef(defId).height / 2, 0], yaw: 0, flip: false, parent: null, parentNode: null, node: null, stage: -1, sym: null, fill: 1 };
}

// ---------------------------------------------------------------- tree

export const childrenOf = (c: Craft, id: string): PartInstance[] => c.parts.filter((p) => p.parent === id);

/** All descendants of `id` (including itself) following the stored attachment links. */
export function subtreeIds(c: Craft, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    for (const ch of childrenOf(c, cur)) stack.push(ch.id);
  }
  return out;
}

/** The part the craft is "hung" from: the first command part if there is one, otherwise the first part placed. */
export function effectiveRoot(c: Craft): string | null {
  const cmd = c.parts.find((p) => partDef(p.def).category === 'command');
  return cmd?.id ?? c.rootId;
}

export interface Tree {
  root: string;
  parent: Map<string, string | null>;
  children: Map<string, string[]>;
  /** Parents before children. */
  order: string[];
}

/** Re-root the attachment graph at the effective root (attachments are undirected). */
export function buildTree(c: Craft): Tree | null {
  const root = effectiveRoot(c);
  if (root === null) return null;
  const adj = new Map<string, string[]>();
  for (const p of c.parts) adj.set(p.id, []);
  for (const p of c.parts) {
    if (p.parent && adj.has(p.parent)) {
      adj.get(p.id)!.push(p.parent);
      adj.get(p.parent)!.push(p.id);
    }
  }
  const parent = new Map<string, string | null>([[root, null]]);
  const children = new Map<string, string[]>(c.parts.map((p) => [p.id, []]));
  const order: string[] = [];
  const queue = [root];
  while (queue.length) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const n of adj.get(cur)!) {
      if (!parent.has(n)) {
        parent.set(n, cur);
        children.get(cur)!.push(n);
        queue.push(n);
      }
    }
  }
  return { root, parent, children, order };
}

/** Parts that share a symmetry group with `id` (including `id`). */
export function symmetrySet(c: Craft, id: string): string[] {
  const p = getPart(c, id);
  if (!p || p.sym === null) return [id];
  return c.parts.filter((q) => q.sym === p.sym).map((q) => q.id);
}

/** Remove a part, its symmetry copies and everything attached beyond them. Returns the removed ids. */
export function removePart(c: Craft, id: string): string[] {
  const doomed = new Set<string>();
  for (const s of symmetrySet(c, id)) for (const d of subtreeIds(c, s)) doomed.add(d);
  c.parts = c.parts.filter((p) => !doomed.has(p.id));
  if (c.rootId !== null && doomed.has(c.rootId)) c.rootId = c.parts[0]?.id ?? null;
  return [...doomed];
}

/** Axis-aligned bounds of all parts (radial parts count by their span, which slightly over-covers them). */
export function craftBounds(c: Craft): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of c.parts) {
    const d = partDef(p.def);
    const reach = d.id === 'dec-radial' ? RADIAL_DECOUPLER_LENGTH : d.surface && d.look !== 'solid' ? d.radius * 2 : d.radius;
    const lo: V3 = [p.pos[0] - reach, p.pos[1] - d.height / 2, p.pos[2] - reach];
    const hi: V3 = [p.pos[0] + reach, p.pos[1] + d.height / 2, p.pos[2] + reach];
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, lo[i]!);
      max[i] = Math.max(max[i]!, hi[i]!);
    }
  }
  return { min, max };
}

// ---------------------------------------------------------------- serialisation

/** Parse and validate craft JSON (from a file or storage). Throws a readable error for anything unusable. */
export function parseCraft(text: string): Craft {
  let data: Partial<Craft>;
  try {
    data = JSON.parse(text) as Partial<Craft>;
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (data.format !== CRAFT_FORMAT || !Array.isArray(data.parts)) throw new Error('Not an Orbital craft file.');
  if (typeof data.version !== 'number' || data.version > CRAFT_VERSION) throw new Error('This craft was made by a newer version of Orbital.');
  const ids = new Set<string>();
  for (const p of data.parts) {
    if (typeof p.id !== 'string' || ids.has(p.id)) throw new Error('Craft has duplicate or missing part ids.');
    ids.add(p.id);
    try {
      partDef(p.def);
    } catch {
      throw new Error(`Craft uses an unknown part "${String(p.def)}".`);
    }
    if (!Array.isArray(p.pos) || p.pos.length !== 3 || p.pos.some((n) => !Number.isFinite(n))) throw new Error(`Part ${p.id} has an invalid position.`);
  }
  for (const p of data.parts) if (p.parent && !ids.has(p.parent)) throw new Error(`Part ${p.id} is attached to a missing part.`);
  const maxId = Math.max(0, ...data.parts.map((p) => Number(p.id.slice(1)) || 0));
  return {
    format: CRAFT_FORMAT,
    version: CRAFT_VERSION,
    name: typeof data.name === 'string' ? data.name : 'Imported craft',
    rootId: data.rootId && ids.has(data.rootId) ? data.rootId : (data.parts[0]?.id ?? null),
    nextId: Math.max(data.nextId ?? 1, maxId + 1),
    nextSym: data.nextSym ?? 1,
    manualStaging: data.manualStaging === true,
    parts: data.parts.map((p) => ({ ...p, fill: typeof p.fill === 'number' ? p.fill : 1, sym: p.sym ?? null, stage: typeof p.stage === 'number' ? p.stage : -1, flip: p.flip === true, yaw: p.yaw ?? 0 })),
  };
}

export const serializeCraft = (c: Craft): string => JSON.stringify(c);

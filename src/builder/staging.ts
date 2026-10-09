/**
 * Staging: which parts fire when. Stage 0 fires first (at launch). Stageable parts are engines, decouplers and parachutes.
 * Auto-staging derives a sensible order from the structure (like a player would); the staging editor can override it, after
 * which the craft is "manually staged" until the player asks for auto again. Pure logic.
 */
import { buildTree, getPart, symmetrySet, type Craft, type PartInstance, type Tree } from './craft';
import { partDef } from './part-library';
import type { PartDef } from './part-types';

export const isStageable = (d: PartDef): boolean => d.engine !== undefined || d.decoupler === true || d.category === 'parachute';

export interface Segments {
  /** Segment of every part. A decoupler belongs to the segment it releases (it leaves with it). */
  of: Map<string, number>;
  /** For each segment: the decoupler that starts it and the segment it hangs from (the root segment has neither). */
  decoupler: Map<number, string>;
  parent: Map<number, number>;
}

/** Split the rooted tree into segments at every decoupler. */
export function segments(c: Craft, tree: Tree): Segments {
  const of = new Map<string, number>();
  const decoupler = new Map<number, string>();
  const parent = new Map<number, number>();
  let next = 1;
  for (const id of tree.order) {
    const inst = getPart(c, id)!;
    const par = tree.parent.get(id);
    if (par === null || par === undefined) {
      of.set(id, 0);
    } else if (partDef(inst.def).decoupler) {
      const seg = next++;
      of.set(id, seg);
      decoupler.set(seg, id);
      parent.set(seg, of.get(par)!);
    } else {
      of.set(id, of.get(par)!);
    }
  }
  return { of, decoupler, parent };
}

/** Default staging from structure: boosters light with their parent stage, stack stages light as the one below separates. */
export function autoStage(c: Craft): void {
  for (const p of c.parts) p.stage = -1;
  c.manualStaging = false;
  const tree = buildTree(c);
  if (!tree) return;
  const seg = segments(c, tree);

  // Serial depth: a stack decoupler adds a stage below, a radial one runs in parallel with its parent.
  const serial = new Map<number, number>([[0, 0]]);
  const ordered = [...seg.decoupler.keys()].sort((a, b) => a - b); // parents have lower ids than children (tree order)
  for (const s of ordered) {
    const dec = getPart(c, seg.decoupler.get(s)!)!;
    const radial = partDef(dec.def).surface === true;
    serial.set(s, serial.get(seg.parent.get(s)!)! + (radial ? 0 : 1));
  }
  const smax = Math.max(...serial.values());
  const ignition = (s: number): number => smax - serial.get(s)!;

  const keys = new Map<string, number>();
  for (const p of c.parts) {
    const d = partDef(p.def);
    if (!isStageable(d)) continue;
    const s = seg.of.get(p.id);
    if (s === undefined) continue; // disconnected from the root: left unstaged
    if (d.decoupler) {
      const parentSeg = seg.parent.get(s)!;
      keys.set(p.id, partDef(p.def).surface ? ignition(parentSeg) + 0.5 : ignition(parentSeg));
    } else if (d.engine) {
      keys.set(p.id, ignition(s));
    } else {
      keys.set(p.id, smax + 1); // parachutes: last
    }
  }
  const distinct = [...new Set(keys.values())].sort((a, b) => a - b);
  for (const p of c.parts) {
    const k = keys.get(p.id);
    if (k !== undefined) p.stage = distinct.indexOf(k);
  }
}

export const stageCount = (c: Craft): number => c.parts.reduce((m, p) => Math.max(m, p.stage + 1), 0);

/** Parts of each stage, in stage order (empty stages cannot exist: stages are kept compact). */
export function stageParts(c: Craft): PartInstance[][] {
  const out: PartInstance[][] = Array.from({ length: stageCount(c) }, () => []);
  for (const p of c.parts) if (p.stage >= 0) out[p.stage]!.push(p);
  return out;
}

/** Renumber stages 0..n-1 without gaps. */
export function compactStages(c: Craft): void {
  const used = [...new Set(c.parts.filter((p) => p.stage >= 0).map((p) => p.stage))].sort((a, b) => a - b);
  for (const p of c.parts) if (p.stage >= 0) p.stage = used.indexOf(p.stage);
}

/** Move a part (and its symmetry copies) to `stage`; a stage number past the end creates a new last stage. */
export function setPartStage(c: Craft, id: string, stage: number): void {
  if (!isStageable(partDef(getPart(c, id)?.def ?? ''))) return;
  for (const sid of symmetrySet(c, id)) getPart(c, sid)!.stage = stage;
  c.manualStaging = true;
  compactStages(c);
}

/** Move a whole stage to a new position in the order. */
export function moveStage(c: Craft, from: number, to: number): void {
  const n = stageCount(c);
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
  const order = Array.from({ length: n }, (_, i) => i);
  order.splice(to, 0, order.splice(from, 1)[0]!);
  const newIndex = new Map(order.map((old, i) => [old, i]));
  for (const p of c.parts) if (p.stage >= 0) p.stage = newIndex.get(p.stage)!;
  c.manualStaging = true;
}

/**
 * Keep staging consistent after an edit: recompute it when automatic; when manual, parts that became stageable (new ones) go
 * into a new last stage and parts that vanished simply leave gaps that are closed up.
 */
export function syncStaging(c: Craft): void {
  if (!c.manualStaging) {
    autoStage(c);
    return;
  }
  const last = stageCount(c);
  for (const p of c.parts) {
    if (p.stage < 0 && isStageable(partDef(p.def))) {
      p.stage = last;
    } else if (p.stage >= 0 && !isStageable(partDef(p.def))) {
      p.stage = -1;
    }
  }
  compactStages(c);
}

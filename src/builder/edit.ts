/**
 * Editing operations on a craft: placement (with radial symmetry), rotate/offset, copy/paste. All pure; the UI calls these and
 * snapshots the craft for undo. Operations return what they changed so callers can report or select it.
 */
import { attachInstance, addInstance, getPart, rootInstance, rotate, subtreeIds, surfaceInstance, symmetrySet, type Craft, type PartInstance, type V3 } from './craft';

export type Placement =
  | { kind: 'root'; def: string }
  | { kind: 'stack'; def: string; target: { partId: string; nodeId: string }; ownNode: string }
  | { kind: 'surface'; def: string; parentId: string; theta: number; y: number };

const TAU = Math.PI * 2;

/**
 * Place a part, copying it round the craft when `count` > 1: side-mounted parts are repeated about the parent's axis (2 is a
 * mirror), and parts added to a member of a symmetry group go on every member. Returns the ids added (empty if the part
 * cannot go there). Nothing is added unless every copy fits.
 */
export function placePart(c: Craft, pl: Placement, count = 1): string[] {
  const made: PartInstance[] = [];
  if (pl.kind === 'root') {
    if (c.parts.length > 0) return [];
    made.push(rootInstance(pl.def));
  } else if (pl.kind === 'stack') {
    const parent = getPart(c, pl.target.partId);
    if (!parent) return [];
    const group = parent.sym !== null ? symmetrySet(c, parent.id) : [parent.id];
    for (const memberId of group) {
      const inst = attachInstance(c, pl.def, { partId: memberId, nodeId: pl.target.nodeId }, pl.ownNode);
      if (!inst) return [];
      made.push(inst);
    }
  } else {
    const parent = getPart(c, pl.parentId);
    if (!parent) return [];
    if (parent.sym !== null) {
      for (const memberId of symmetrySet(c, parent.id)) {
        const member = getPart(c, memberId)!;
        const inst = surfaceInstance(c, pl.def, memberId, pl.theta + (parent.yaw - member.yaw), pl.y);
        if (!inst) return [];
        made.push(inst);
      }
    } else {
      const n = Math.max(1, count);
      for (let k = 0; k < n; k++) {
        const inst = surfaceInstance(c, pl.def, pl.parentId, pl.theta + (TAU * k) / n, pl.y);
        if (!inst) return [];
        made.push(inst);
      }
    }
  }
  const sym = made.length > 1 ? c.nextSym++ : null;
  return made.map((m) => addInstance(c, { ...m, sym }).id);
}

/** Rotate `pos` about the vertical axis through (px, pz) by `phi`, in the same sense as a part's yaw. */
function spin(pos: V3, px: number, pz: number, phi: number): V3 {
  const dx = pos[0] - px;
  const dz = pos[2] - pz;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  return [px + dx * cos + dz * sin, pos[1], pz - dx * sin + dz * cos];
}

/**
 * Turn a part (and its symmetry copies) by `dyaw`: side-mounted parts orbit their parent's axis, stack parts turn about their
 * own axis, taking everything attached beyond them along. Parts hung on a radial decoupler cannot be turned on their own.
 */
export function rotatePart(c: Craft, id: string, dyaw: number): boolean {
  let moved = false;
  for (const sid of symmetrySet(c, id)) {
    const part = getPart(c, sid);
    if (!part) continue;
    let px = part.pos[0];
    let pz = part.pos[2];
    if (part.node === 'surface' && part.parentNode === 'surface' && part.parent) {
      const parent = getPart(c, part.parent)!;
      px = parent.pos[0];
      pz = parent.pos[2];
    } else if (part.node === 'surface') {
      continue;
    }
    for (const tid of subtreeIds(c, sid)) {
      const t = getPart(c, tid)!;
      t.pos = spin(t.pos, px, pz, dyaw);
      t.yaw += dyaw;
    }
    moved = true;
  }
  return moved;
}

/** Slide a side-mounted part (and copies, and what hangs on them) up or down its parent. */
export function offsetPart(c: Craft, id: string, dy: number): boolean {
  let moved = false;
  for (const sid of symmetrySet(c, id)) {
    const part = getPart(c, sid);
    if (!part || part.parentNode !== 'surface') continue;
    for (const tid of subtreeIds(c, sid)) getPart(c, tid)!.pos[1] += dy;
    moved = true;
  }
  return moved;
}

// ---------------------------------------------------------------- copy / paste

export interface Clipboard {
  /** The copied part first, then everything attached beyond it; ids are the original ones. */
  parts: PartInstance[];
}

export function copySubtree(c: Craft, id: string): Clipboard | null {
  if (!getPart(c, id)) return null;
  return { parts: subtreeIds(c, id).map((tid) => JSON.parse(JSON.stringify(getPart(c, tid))) as PartInstance) };
}

/** Orientation of `part` relative to `root`: root^-1 * part, as (yaw, flip). Flip is a half turn about X, which mirrors yaw. */
function relativeOrientation(root: { yaw: number; flip: boolean }, part: { yaw: number; flip: boolean }) {
  const d = part.yaw - root.yaw;
  return { yaw: root.flip ? -d : d, flip: root.flip !== part.flip };
}

/**
 * Paste a copy so that its first part takes `placement`'s attachment (the part itself is re-derived from the placement, so it
 * snaps like any new part); the rest keep their shape relative to it. Returns the new ids, or [] if it does not fit.
 */
export function pasteSubtree(c: Craft, clip: Clipboard, pl: Placement): string[] {
  const src = clip.parts[0];
  if (!src) return [];
  let target: PartInstance | null = null;
  if (pl.kind === 'stack') target = attachInstance(c, src.def, pl.target, pl.ownNode);
  else if (pl.kind === 'surface') target = surfaceInstance(c, src.def, pl.parentId, pl.theta, pl.y);
  if (!target) return [];

  const idMap = new Map<string, string>();
  const made: PartInstance[] = [];
  for (const p of clip.parts) {
    // Offset from the copied root in its own frame, re-expressed in the frame the new root has been given.
    const local = unrotate(src, [p.pos[0] - src.pos[0], p.pos[1] - src.pos[1], p.pos[2] - src.pos[2]]);
    const out = rotate(target, local);
    const orient = composeOrientation(target, relativeOrientation(src, p));
    idMap.set(p.id, `p${c.nextId++}`);
    made.push({
      ...p,
      id: idMap.get(p.id)!,
      pos: [target.pos[0] + out[0], target.pos[1] + out[1], target.pos[2] + out[2]],
      yaw: orient.yaw,
      flip: orient.flip,
      sym: null,
    });
  }
  made.forEach((m, i) => {
    const orig = clip.parts[i]!;
    m.parent = i === 0 ? target!.parent : (idMap.get(orig.parent ?? '') ?? null);
    m.parentNode = i === 0 ? target!.parentNode : orig.parentNode;
    m.node = i === 0 ? target!.node : orig.node;
    m.stage = -1;
  });
  for (const m of made) c.parts.push(m);
  if (c.rootId === null) c.rootId = made[0]!.id;
  return made.map((m) => m.id);
}

/** Inverse of rotate(): a craft-frame offset expressed in a part's local frame (undo the yaw, then the flip). */
function unrotate(frame: { yaw: number; flip: boolean }, v: V3): V3 {
  const c = Math.cos(-frame.yaw);
  const s = Math.sin(-frame.yaw);
  const x = v[0] * c + v[2] * s;
  const z = -v[0] * s + v[2] * c;
  return frame.flip ? [x, -v[1], -z] : [x, v[1], z];
}

/** new = frame * local, where each is (yaw about Y after an optional half turn about X). */
function composeOrientation(frame: { yaw: number; flip: boolean }, local: { yaw: number; flip: boolean }): { yaw: number; flip: boolean } {
  return { yaw: frame.yaw + (frame.flip ? -local.yaw : local.yaw), flip: frame.flip !== local.flip };
}

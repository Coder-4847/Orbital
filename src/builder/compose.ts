/**
 * Small helpers for building crafts in code (example crafts, tests): stack parts above or below one another and bolt radial
 * parts round a parent. They go through the same placement rules as the Hangar, and throw if a part does not fit.
 */
import { getPart, newCraft, type Craft } from './craft';
import { placePart } from './edit';
import { partDef } from './part-library';
import { syncStaging } from './staging';

function must(ids: string[], what: string): string {
  const id = ids[0];
  if (!id) throw new Error(`Cannot attach ${what}`);
  return id;
}

/** Attach `defId` under `parentId` (its top node to the parent's bottom node). Returns the new part id. */
export function below(c: Craft, parentId: string, defId: string): string {
  return must(placePart(c, { kind: 'stack', def: defId, target: { partId: parentId, nodeId: 'bottom' }, ownNode: 'top' }), defId);
}

/** Attach `defId` under `parentId` joined through its own node `ownNode` (e.g. 'bottom' for an adapter hung wide end up), at the parent's node `targetNode` (a flipped part's free end is its 'top'). */
export function belowVia(c: Craft, parentId: string, defId: string, ownNode: string, targetNode = 'bottom'): string {
  return must(placePart(c, { kind: 'stack', def: defId, target: { partId: parentId, nodeId: targetNode }, ownNode }), defId);
}

/** Attach `defId` on top of `parentId` (its bottom node to the parent's top node). */
export function above(c: Craft, parentId: string, defId: string): string {
  return must(placePart(c, { kind: 'stack', def: defId, target: { partId: parentId, nodeId: 'top' }, ownNode: 'bottom' }), defId);
}

/** Bolt `count` copies of a side-mounted part round `parentId` at height `y` (default: the parent's lower quarter). */
export function radial(c: Craft, parentId: string, defId: string, count: number, y?: number, theta = 0): string[] {
  const parent = getPart(c, parentId)!;
  const h = partDef(parent.def).height;
  const ids = placePart(c, { kind: 'surface', def: defId, parentId, theta, y: y ?? parent.pos[1] - h / 4 }, count);
  if (ids.length === 0) throw new Error(`Cannot attach ${defId}`);
  return ids;
}

/** Hang a side-mounted part (a booster) on the outer end of a radial decoupler. */
export function onDecoupler(c: Craft, decouplerId: string, defId: string): string {
  return must(placePart(c, { kind: 'stack', def: defId, target: { partId: decouplerId, nodeId: 'outer' }, ownNode: 'surface' }), defId);
}

/** Start a craft with its first part and return both. */
export function startCraft(name: string, firstDef: string): { craft: Craft; root: string } {
  const craft = newCraft(name);
  const root = must(placePart(craft, { kind: 'root', def: firstDef }), firstDef);
  return { craft, root };
}

/** Finish a hand-built craft: derive its staging. */
export function finish(c: Craft): Craft {
  syncStaging(c);
  return c;
}

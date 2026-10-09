import { describe, expect, it } from 'vitest';
import { getPart, newCraft } from '../src/builder/craft';
import { AUTOSAVE_KEY, HangarEditor, UNLIMITED_KEY, type KeyValueStore } from '../src/builder/editor';
import { EXAMPLES } from '../src/builder/examples';
import { computeStats } from '../src/builder/stats';

const memoryStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

/** Build a small rocket the way the UI does: pick a tool, place at a snap target. */
function buildRocket(ed: HangarEditor): { pod: string; tank: string; engine: string } {
  ed.setTool({ kind: 'part', def: 'pod-capsule' });
  const [pod] = ed.place({ kind: 'root', def: 'pod-capsule' });
  ed.setTool({ kind: 'part', def: 'tank-125-2' });
  const [tank] = ed.place({ kind: 'stack', def: 'tank-125-2', target: { partId: pod!, nodeId: 'bottom' }, ownNode: 'top' });
  ed.setTool({ kind: 'part', def: 'eng-sea-850' });
  const [engine] = ed.place({ kind: 'stack', def: 'eng-sea-850', target: { partId: tank!, nodeId: 'bottom' }, ownNode: 'top' });
  return { pod: pod!, tank: tank!, engine: engine! };
}

describe('HangarEditor', () => {
  it('builds, stages automatically, and every step can be undone and redone', () => {
    const ed = new HangarEditor();
    const { engine } = buildRocket(ed);
    expect(ed.craft.parts).toHaveLength(3);
    expect(getPart(ed.craft, engine)!.stage).toBe(0);
    expect(computeStats(ed.craft).dvVac).toBeGreaterThan(0);
    expect(ed.undo()).toBe(true);
    expect(ed.craft.parts).toHaveLength(2);
    expect(ed.undo()).toBe(true);
    expect(ed.undo()).toBe(true);
    expect(ed.craft.parts).toHaveLength(0);
    expect(ed.canUndo).toBe(false);
    ed.redo();
    ed.redo();
    ed.redo();
    expect(ed.craft.parts).toHaveLength(3);
    expect(ed.canRedo).toBe(false);
  });

  it('previews without changing the craft, and refuses a part that does not fit', () => {
    const ed = new HangarEditor();
    const { pod } = buildRocket(ed);
    ed.setTool({ kind: 'part', def: 'tank-250-4' });
    const before = ed.craft.parts.length;
    const bad = ed.preview({ kind: 'stack', def: 'tank-250-4', target: { partId: pod, nodeId: 'top' }, ownNode: 'bottom' });
    expect(bad.ok).toBe(false);
    expect(ed.place({ kind: 'stack', def: 'tank-250-4', target: { partId: pod, nodeId: 'top' }, ownNode: 'bottom' })).toEqual([]);
    expect(ed.craft.parts).toHaveLength(before);
    ed.setTool({ kind: 'part', def: 'chute-main' });
    const good = ed.preview({ kind: 'stack', def: 'chute-main', target: { partId: pod, nodeId: 'top' }, ownNode: 'bottom' });
    expect(good.ok).toBe(true);
    expect(good.parts).toHaveLength(1);
    expect(ed.craft.parts).toHaveLength(before);
  });

  it('symmetry places the chosen number of copies and selection takes them all', () => {
    const ed = new HangarEditor();
    const { tank } = buildRocket(ed);
    ed.setSymmetry(3);
    ed.setTool({ kind: 'part', def: 'fin-small' });
    const ids = ed.place({ kind: 'surface', def: 'fin-small', parentId: tank, theta: 0.4, y: getPart(ed.craft, tank)!.pos[1] });
    expect(ids).toHaveLength(3);
    expect(ed.selection).toHaveLength(3);
    ed.deleteSelection();
    expect(ed.craft.parts).toHaveLength(3);
    ed.cycleSymmetry();
    expect(ed.symmetry).toBe(4);
  });

  it('enforces build limits unless the cheat is on, and remembers the cheat', () => {
    const store = memoryStore();
    const ed = new HangarEditor(newCraft(), store);
    ed.setTool({ kind: 'part', def: 'tank-125-4' });
    let last = ed.place({ kind: 'root', def: 'tank-125-4' })[0]!;
    let refused = 0;
    for (let i = 0; i < 40 && refused === 0; i++) {
      const ids = ed.place({ kind: 'stack', def: 'tank-125-4', target: { partId: last, nodeId: 'bottom' }, ownNode: 'top' });
      if (ids.length === 0) refused++;
      else last = ids[0]!;
    }
    expect(refused).toBe(1); // the hangar door is 130 m
    ed.setUnlimited(true);
    expect(store.data.get(UNLIMITED_KEY)).toBe('1');
    expect(ed.place({ kind: 'stack', def: 'tank-125-4', target: { partId: last, nodeId: 'bottom' }, ownNode: 'top' })).toHaveLength(1);
    expect(new HangarEditor(newCraft(), store).unlimited).toBe(true);
  });

  it('copy then paste duplicates a subtree at a new attachment', () => {
    const ed = new HangarEditor();
    const { tank } = buildRocket(ed);
    ed.setTool({ kind: 'part', def: 'dec-radial' });
    const [dec] = ed.place({ kind: 'surface', def: 'dec-radial', parentId: tank, theta: 0, y: getPart(ed.craft, tank)!.pos[1] });
    ed.select(dec!);
    expect(ed.copySelection()).toBe(true);
    expect(ed.beginPaste()).toBe(true);
    const ids = ed.place({ kind: 'surface', def: 'dec-radial', parentId: tank, theta: Math.PI, y: getPart(ed.craft, tank)!.pos[1] });
    expect(ids).toHaveLength(1);
    expect(ed.craft.parts.filter((p) => p.def === 'dec-radial')).toHaveLength(2);
  });

  it('rotates and offsets the selection as one undoable step each', () => {
    const ed = new HangarEditor();
    const { tank } = buildRocket(ed);
    ed.setTool({ kind: 'part', def: 'fin-small' });
    const [fin] = ed.place({ kind: 'surface', def: 'fin-small', parentId: tank, theta: 0, y: getPart(ed.craft, tank)!.pos[1] });
    const y = getPart(ed.craft, fin!)!.pos[1];
    expect(ed.offsetSelection(0.25)).toBe(true);
    expect(getPart(ed.craft, fin!)!.pos[1]).toBeCloseTo(y + 0.25, 9);
    expect(ed.rotateSelection(Math.PI / 6)).toBe(true);
    ed.undo();
    ed.undo();
    expect(getPart(ed.craft, fin!)!.pos[1]).toBeCloseTo(y, 9);
    ed.select(null);
    expect(ed.rotateSelection(1)).toBe(false);
  });

  it('autosaves after every edit and restores it, ignoring corrupt data', () => {
    const store = memoryStore();
    const ed = new HangarEditor(newCraft(), store);
    buildRocket(ed);
    expect(store.data.has(AUTOSAVE_KEY)).toBe(true);
    const back = HangarEditor.restore(store)!;
    expect(back.parts).toEqual(ed.craft.parts);
    store.data.set(AUTOSAVE_KEY, '{broken');
    expect(HangarEditor.restore(store)).toBeNull();
  });

  it('loading a craft (an example) starts a fresh history and clears the tool', () => {
    const ed = new HangarEditor();
    buildRocket(ed);
    ed.load(EXAMPLES[0]!.build());
    expect(ed.canUndo).toBe(false);
    expect(ed.tool).toBeNull();
    expect(ed.craft.parts.length).toBeGreaterThan(10);
    ed.rename('  My rocket ');
    expect(ed.craft.name).toBe('My rocket');
    expect(ed.canUndo).toBe(true);
  });

  it('manual staging edits stick, and can be undone', () => {
    const ed = new HangarEditor();
    ed.load(EXAMPLES[0]!.build());
    const eng = ed.craft.parts.find((p) => p.def === 'eng-vacuum-110')!;
    expect(eng.stage).toBe(1);
    ed.setStage(eng.id, 0);
    expect(ed.craft.manualStaging).toBe(true);
    expect(getPart(ed.craft, eng.id)!.stage).toBe(0);
    ed.undo();
    expect(getPart(ed.craft, eng.id)!.stage).toBe(1);
    ed.reorderStage(0, 1);
    ed.autoStaging();
    expect(ed.craft.manualStaging).toBe(false);
    expect(getPart(ed.craft, eng.id)!.stage).toBe(1);
  });
});

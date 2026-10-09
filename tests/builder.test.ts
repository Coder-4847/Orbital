import { describe, expect, it } from 'vitest';
import { above, below, finish, onDecoupler, radial, startCraft } from '../src/builder/compose';
import {
  attachInstance,
  buildTree,
  cloneCraft,
  craftBounds,
  effectiveRoot,
  freeNodes,
  getPart,
  newCraft,
  parseCraft,
  removePart,
  serializeCraft,
  subtreeIds,
  symmetrySet,
} from '../src/builder/craft';
import { copySubtree, offsetPart, pasteSubtree, placePart, rotatePart } from '../src/builder/edit';
import { EXAMPLES } from '../src/builder/examples';
import { History } from '../src/builder/history';
import { LIMITS, adviceFor, limitViolations } from '../src/builder/limits';
import { PART_LIBRARY, partDef } from '../src/builder/part-library';
import { findStackSnap, surfaceFromHit } from '../src/builder/snap';
import { autoStage, moveStage, setPartStage, stageCount, stageParts, syncStaging } from '../src/builder/staging';
import { computeStats } from '../src/builder/stats';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('part library', () => {
  it('has unique ids and sane data for every part', () => {
    const ids = new Set(PART_LIBRARY.map((p) => p.id));
    expect(ids.size).toBe(PART_LIBRARY.length);
    for (const p of PART_LIBRARY) {
      expect(p.height).toBeGreaterThan(0);
      expect(p.radius).toBeGreaterThan(0);
      expect(p.dryMass).toBeGreaterThan(0);
      if (p.engine) {
        expect(p.engine.thrustVac).toBeGreaterThanOrEqual(p.engine.thrustSL);
        expect(p.engine.ispVac).toBeGreaterThanOrEqual(p.engine.ispSL);
      }
    }
  });

  it('covers every category the design asks for', () => {
    const cats = new Set(PART_LIBRARY.map((p) => p.category));
    for (const c of ['command', 'tank', 'engine', 'decoupler', 'aero', 'fins', 'landing', 'parachute', 'heatshield', 'power', 'rcs', 'sas', 'structural']) expect(cats.has(c as never)).toBe(true);
    expect(PART_LIBRARY.some((p) => p.id.startsWith('eng-') && p.engine?.propellant === 'xenon')).toBe(true);
  });
});

describe('stacking and nodes', () => {
  it('stacked parts touch exactly, top to bottom', () => {
    const { craft, root } = startCraft('s', 'pod-capsule');
    const tank = below(craft, root, 'tank-125-2');
    const a = getPart(craft, root)!;
    const b = getPart(craft, tank)!;
    close(a.pos[1] - partDef('pod-capsule').height / 2, b.pos[1] + partDef('tank-125-2').height / 2);
  });

  it('refuses nodes of different sizes and occupied nodes, but an adapter bridges sizes', () => {
    const { craft, root } = startCraft('s', 'tank-125-2');
    expect(attachInstance(craft, 'tank-250-4', { partId: root, nodeId: 'bottom' }, 'top')).toBeNull();
    const ad = below(craft, root, 'adapter-125-250');
    below(craft, ad, 'tank-250-4');
    expect(placePart(craft, { kind: 'stack', def: 'tank-125-1', target: { partId: root, nodeId: 'bottom' }, ownNode: 'top' })).toEqual([]);
  });

  it('flips a part when it is joined through its far end', () => {
    const { craft, root } = startCraft('s', 'tank-125-2');
    const ids = placePart(craft, { kind: 'stack', def: 'adapter-125-250', target: { partId: root, nodeId: 'top' }, ownNode: 'top' });
    expect(ids).toHaveLength(1);
    const adapter = getPart(craft, ids[0]!)!;
    expect(adapter.flip).toBe(true); // its 1.25 m end joins the tank, so the wide end points up
    close(adapter.pos[1] - partDef('adapter-125-250').height / 2, getPart(craft, root)!.pos[1] + partDef('tank-125-2').height / 2);
  });

  it('reports free nodes and the engine bell as an open end', () => {
    const { craft, root } = startCraft('s', 'pod-capsule');
    const tank = below(craft, root, 'tank-125-2');
    below(craft, tank, 'eng-sea-850');
    const free = freeNodes(craft).map((n) => `${getPart(craft, n.partId)!.def}:${n.nodeId}`);
    expect(free).toContain('pod-capsule:top');
    expect(free).toContain('eng-sea-850:bottom');
    expect(free).not.toContain('tank-125-2:top');
  });

  it('re-roots at the command pod whatever was placed first', () => {
    const { craft, root } = startCraft('s', 'eng-sea-850');
    const tank = above(craft, root, 'tank-125-2');
    const pod = above(craft, tank, 'pod-capsule');
    expect(effectiveRoot(craft)).toBe(pod);
    const tree = buildTree(craft)!;
    expect(tree.parent.get(tank)).toBe(pod);
    expect(tree.parent.get(root)).toBe(tank);
  });
});

describe('symmetry and side attachment', () => {
  it('N-fold symmetry puts N copies evenly round the parent', () => {
    const { craft, root } = startCraft('s', 'tank-250-4');
    const ids = radial(craft, root, 'fin-small', 4, 2);
    expect(ids).toHaveLength(4);
    const parent = getPart(craft, root)!;
    const angles = ids.map((id) => {
      const p = getPart(craft, id)!;
      return Math.atan2(p.pos[2] - parent.pos[2], p.pos[0] - parent.pos[0]);
    });
    angles.sort((a, b) => a - b);
    for (let i = 1; i < 4; i++) close(angles[i]! - angles[i - 1]!, Math.PI / 2, 1e-9);
    for (const id of ids) {
      const p = getPart(craft, id)!;
      close(Math.hypot(p.pos[0] - parent.pos[0], p.pos[2] - parent.pos[2]), 1.25, 1e-9);
      expect(p.sym).toBe(getPart(craft, ids[0]!)!.sym);
    }
  });

  it('removing one of a symmetry group removes them all, with everything attached to them', () => {
    const { craft, root } = startCraft('s', 'tank-250-4');
    const decs = radial(craft, root, 'dec-radial', 2, 2);
    onDecoupler(craft, decs[0]!, 'srb-large');
    expect(craft.parts).toHaveLength(1 + 2 + 2);
    const removed = removePart(craft, decs[1]!);
    expect(removed).toHaveLength(4);
    expect(craft.parts).toHaveLength(1);
  });

  it('parts added to one member of a symmetry group appear on every member', () => {
    const { craft, root } = startCraft('s', 'tank-250-4');
    const decs = radial(craft, root, 'dec-radial', 3, 2);
    const boosters = placePart(craft, { kind: 'stack', def: 'srb-large', target: { partId: decs[0]!, nodeId: 'outer' }, ownNode: 'surface' });
    expect(boosters).toHaveLength(3);
    expect(symmetrySet(craft, boosters[0]!)).toHaveLength(3);
  });

  it('a booster hangs off the outer end of its decoupler, standing clear of the core', () => {
    const { craft, root } = startCraft('s', 'tank-250-4');
    const [dec] = radial(craft, root, 'dec-radial', 1, 2);
    const srb = onDecoupler(craft, dec!, 'srb-large');
    const core = getPart(craft, root)!;
    const b = getPart(craft, srb)!;
    // core radius + decoupler length + booster radius
    close(Math.hypot(b.pos[0] - core.pos[0], b.pos[2] - core.pos[2]), 1.25 + 0.5 + 0.625, 1e-9);
  });

  it('rotating a side part orbits its parent and takes attached parts with it; offset slides it up', () => {
    const { craft, root } = startCraft('s', 'tank-250-4');
    const [dec] = radial(craft, root, 'dec-radial', 1, 2, 0);
    const srb = onDecoupler(craft, dec!, 'srb-large');
    const before = getPart(craft, srb)!.pos;
    const r0 = Math.hypot(before[0], before[2]);
    expect(rotatePart(craft, dec!, Math.PI / 2)).toBe(true);
    const after = getPart(craft, srb)!.pos;
    close(Math.hypot(after[0], after[2]), r0, 1e-9);
    expect(Math.abs(after[0] - before[0])).toBeGreaterThan(1);
    expect(rotatePart(craft, srb, 1)).toBe(false); // hung on a decoupler: moves only with it
    const y0 = getPart(craft, srb)!.pos[1];
    expect(offsetPart(craft, dec!, 0.5)).toBe(true);
    close(getPart(craft, srb)!.pos[1], y0 + 0.5);
  });
});

describe('copy and paste', () => {
  it('pasting a subtree back at the same attachment reproduces it exactly', () => {
    const { craft, root } = startCraft('s', 'tank-250-4');
    const [dec] = radial(craft, root, 'dec-radial', 1, 2, 0.7);
    const srb = onDecoupler(craft, dec!, 'srb-large');
    const clip = copySubtree(craft, dec!)!;
    expect(clip.parts).toHaveLength(2);
    const original = getPart(craft, dec!)!;
    const theta = Math.atan2(original.pos[2], original.pos[0]);
    const made = pasteSubtree(craft, clip, { kind: 'surface', def: 'dec-radial', parentId: root, theta: theta + Math.PI, y: original.pos[1] });
    expect(made).toHaveLength(2);
    const copyDec = getPart(craft, made[0]!)!;
    const copySrb = getPart(craft, made[1]!)!;
    // The copy is the original rotated half a turn about the core's axis.
    close(copySrb.pos[0], -getPart(craft, srb)!.pos[0], 1e-9);
    close(copySrb.pos[2], -getPart(craft, srb)!.pos[2], 1e-9);
    close(copySrb.pos[1], getPart(craft, srb)!.pos[1], 1e-9);
    expect(copySrb.parent).toBe(copyDec.id);
    expect(copyDec.parent).toBe(root);
    expect(subtreeIds(craft, copyDec.id)).toHaveLength(2);
  });
});

describe('snapping', () => {
  it('picks the free node nearest the pointing ray and chooses the matching end', () => {
    const { craft, root } = startCraft('s', 'pod-capsule');
    const tank = below(craft, root, 'tank-125-2');
    const bottom = freeNodes(craft).find((n) => n.partId === tank && n.nodeId === 'bottom')!;
    const ray = { origin: [bottom.pos[0] + 3, bottom.pos[1] - 0.1, bottom.pos[2]] as [number, number, number], dir: [-1, 0, 0] as [number, number, number] };
    const snap = findStackSnap(craft, 'eng-sea-850', ray, 1)!;
    expect(snap.target).toEqual({ partId: tank, nodeId: 'bottom' });
    expect(snap.ownNode).toBe('top');
    expect(findStackSnap(craft, 'eng-sea-850', { origin: [50, 50, 50], dir: [1, 0, 0] }, 1)).toBeNull();
  });

  it('side placement gives an angle round the parent and a grid-snapped height', () => {
    const { craft, root } = startCraft('s', 'tank-125-4');
    const s = surfaceFromHit(craft, 'fin-small', root, [0, 2.123, 0.6])!;
    close(s.theta, Math.PI / 2, 1e-9);
    close(s.y, 2.1, 1e-9);
    expect(surfaceFromHit(craft, 'tank-125-2', root, [0, 1, 1])).toBeNull(); // not a side-mounted part
  });
});

describe('staging', () => {
  it('auto-staging lights the engine of the lowest stage first and fires decouplers with the stage above', () => {
    const c = EXAMPLES.find((e) => e.id === 'sparrow')!.build();
    const groups = stageParts(c).map((g) => g.map((p) => p.def).sort());
    expect(groups[0]).toEqual(['eng-sea-850']);
    expect(groups[1]).toEqual(['dec-125', 'eng-vacuum-110']);
    expect(groups[2]).toEqual(['chute-main']);
  });

  it('boosters light with the core and drop away in a later stage of their own', () => {
    const c = EXAMPLES.find((e) => e.id === 'atlas')!.build();
    const groups = stageParts(c).map((g) => g.map((p) => p.def));
    expect(groups[0]).toContain('srb-large');
    expect(groups[0]).toContain('eng-heavy-4500');
    expect(groups[1]).toEqual(['dec-radial', 'dec-radial']);
  });

  it('manual staging survives later edits; auto resets it', () => {
    const { craft, root } = startCraft('s', 'pod-capsule');
    const tank = below(craft, root, 'tank-125-2');
    const eng = below(craft, tank, 'eng-sea-850');
    finish(craft);
    expect(stageCount(craft)).toBe(1);
    setPartStage(craft, eng, 3);
    expect(craft.manualStaging).toBe(true);
    expect(getPart(craft, eng)!.stage).toBe(0); // stages stay compact
    above(craft, root, 'chute-main');
    syncStaging(craft);
    expect(getPart(craft, eng)!.stage).toBe(0);
    expect(stageCount(craft)).toBe(2);
    moveStage(craft, 0, 1);
    expect(getPart(craft, eng)!.stage).toBe(1);
    autoStage(craft);
    expect(craft.manualStaging).toBe(false);
    expect(getPart(craft, eng)!.stage).toBe(0);
  });
});

describe('examples', () => {
  it('every example loads, fits the hangar, round-trips, and has believable numbers', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(3);
    for (const ex of EXAMPLES) {
      const c = ex.build();
      expect(limitViolations(c)).toEqual([]);
      expect(adviceFor(c).filter((a) => a.level === 'warning' && !(ex.orbitOnly && /thrust-to-weight/i.test(a.text)))).toEqual([]);
      const back = parseCraft(serializeCraft(c));
      expect(computeStats(back).dvVac).toBeCloseTo(computeStats(c).dvVac, 6);
      expect(stageCount(c)).toBeGreaterThan(1);
    }
    const sparrow = computeStats(EXAMPLES[0]!.build());
    expect(sparrow.dvVac).toBeGreaterThan(9000); // low Earth orbit needs about 9.4 km/s with losses
    expect(sparrow.twrSL).toBeGreaterThan(1.3);
    expect(computeStats(EXAMPLES[1]!.build()).dvVac).toBeGreaterThan(11000);
  });
});

describe('save format', () => {
  it('survives JSON, and rejects bad files with readable errors', () => {
    const c = EXAMPLES[0]!.build();
    const back = parseCraft(serializeCraft(c));
    expect(back.parts).toEqual(c.parts);
    expect(back.name).toBe(c.name);
    expect(() => parseCraft('nope')).toThrow(/JSON/);
    expect(() => parseCraft('{"format":"other"}')).toThrow(/craft file/);
    expect(() => parseCraft(JSON.stringify({ ...c, version: 99 }))).toThrow(/newer/);
    expect(() => parseCraft(JSON.stringify({ ...c, parts: [{ ...c.parts[0], def: 'warp-drive' }] }))).toThrow(/unknown part/);
    expect(() => parseCraft(JSON.stringify({ ...c, parts: [{ ...c.parts[0], parent: 'ghost' }] }))).toThrow(/missing part/);
  });

  it('keeps allocating fresh ids after loading', () => {
    const c = parseCraft(serializeCraft(EXAMPLES[0]!.build()));
    const engine = c.parts.find((p) => p.def === 'eng-sea-850')!.id;
    const added = below(c, engine, 'dec-125');
    expect(new Set(c.parts.map((p) => p.id)).size).toBe(c.parts.length);
    expect(getPart(c, added)).toBeDefined();
  });
});

describe('undo and redo', () => {
  it('walks back and forward through snapshots and drops the redo branch on a new edit', () => {
    const craft = newCraft('h');
    const h = new History(craft);
    placePart(craft, { kind: 'root', def: 'tank-125-2' });
    h.push(craft);
    above(craft, craft.parts[0]!.id, 'cone-125');
    h.push(craft);
    expect(h.canUndo).toBe(true);
    const back = h.undo()!;
    expect(back.parts).toHaveLength(1);
    expect(h.canRedo).toBe(true);
    expect(h.redo()!.parts).toHaveLength(2);
    h.undo();
    const branch = cloneCraft(back);
    below(branch, branch.parts[0]!.id, 'eng-spark');
    h.push(branch);
    expect(h.canRedo).toBe(false);
    expect(h.undo()!.parts).toHaveLength(1);
    expect(h.undo()!.parts).toHaveLength(0);
    expect(h.undo()).toBeNull();
  });
});

describe('limits and advice', () => {
  it('flags a craft that is too tall and warns about a rocket that cannot lift off', () => {
    const { craft, root } = startCraft('tall', 'tank-125-4');
    let last = root;
    for (let i = 0; i < 40; i++) last = below(craft, last, 'tank-125-4');
    expect(limitViolations(craft).some((v) => v.includes('tall'))).toBe(true);
    expect(LIMITS.maxHeight).toBeGreaterThan(0);

    const { craft: bare, root: r } = startCraft('bare', 'pod-capsule');
    below(bare, r, 'tank-125-2');
    expect(adviceFor(bare).some((x) => /No engines/.test(x.text))).toBe(true);

    const { craft: weak, root: w } = startCraft('weak', 'pod-cabin');
    below(weak, below(weak, w, 'tank-250-8'), 'eng-vac-600');
    finish(weak);
    expect(computeStats(weak).twrSL).toBeLessThan(1);
    expect(adviceFor(weak).some((x) => /will not leave the pad/.test(x.text))).toBe(true);
  });

  it('bounds cover every part', () => {
    const c = EXAMPLES[0]!.build();
    const b = craftBounds(c);
    for (const p of c.parts) {
      expect(p.pos[1]).toBeGreaterThanOrEqual(b.min[1]);
      expect(p.pos[1]).toBeLessThanOrEqual(b.max[1]);
    }
  });
});

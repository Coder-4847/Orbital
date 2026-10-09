import { describe, expect, it } from 'vitest';
import { above, below, finish, onDecoupler, radial, startCraft } from '../src/builder/compose';
import { partDef } from '../src/builder/part-library';
import { computeStats, engineAt, G0 } from '../src/builder/stats';

const near = (a: number, b: number, rel = 1e-3) => expect(Math.abs(a - b) / Math.max(1, Math.abs(b))).toBeLessThan(rel);
const m = (id: string) => partDef(id).dryMass;
const p = (id: string) => partDef(id).propellant?.mass ?? 0;

describe('rocket equation', () => {
  it('single stage: dv = Isp * g0 * ln(m0 / m1) in vacuum, and lower at sea level', () => {
    const { craft, root } = startCraft('one', 'pod-capsule');
    const tank = below(craft, root, 'tank-125-4');
    below(craft, tank, 'eng-vacuum-110');
    finish(craft);
    const dry = m('pod-capsule') + m('tank-125-4') + m('eng-vacuum-110');
    const wet = dry + p('tank-125-4');
    const s = computeStats(craft);
    near(s.dvVac, 435 * G0 * Math.log(wet / dry));
    near(s.dvSL, 190 * G0 * Math.log(wet / dry));
    near(s.wetMass, wet);
    near(s.dryMass, dry);
    expect(s.stages).toHaveLength(1);
  });

  it('thrust-to-weight is thrust over weight at ignition', () => {
    const { craft, root } = startCraft('twr', 'pod-capsule');
    const tank = below(craft, root, 'tank-125-2');
    below(craft, tank, 'eng-sea-850');
    finish(craft);
    const s = computeStats(craft);
    const spec = partDef('eng-sea-850').engine!;
    near(s.twrSL, engineAt(spec, 1).thrust / (s.wetMass * G0));
    near(s.twrVac, engineAt(spec, 0).thrust / (s.wetMass * G0));
    expect(s.twrSL).toBeLessThan(s.twrVac);
  });

  it('two serial stages: each stage burns its own tank and the dead stage is dropped', () => {
    const { craft, root } = startCraft('two', 'pod-capsule');
    const t2 = below(craft, root, 'tank-125-2');
    const e2 = below(craft, t2, 'eng-vacuum-110');
    const dec = below(craft, e2, 'dec-125');
    const t1 = below(craft, dec, 'tank-125-4');
    below(craft, t1, 'eng-sea-850');
    finish(craft);
    const s = computeStats(craft);
    expect(s.stages).toHaveLength(2);

    const m0 = m('pod-capsule') + m('tank-125-2') + p('tank-125-2') + m('eng-vacuum-110') + m('dec-125') + m('tank-125-4') + p('tank-125-4') + m('eng-sea-850');
    near(s.stages[0]!.dvVac, 311 * G0 * Math.log(m0 / (m0 - p('tank-125-4'))));
    near(s.stages[0]!.massStart, m0);

    const m1 = m('pod-capsule') + m('tank-125-2') + p('tank-125-2') + m('eng-vacuum-110');
    near(s.stages[1]!.dvVac, 435 * G0 * Math.log(m1 / (m1 - p('tank-125-2'))));
    near(s.stages[1]!.massStart, m1);
    near(s.dvVac, s.stages[0]!.dvVac + s.stages[1]!.dvVac);
    expect(s.stages[0]!.twrSL).toBeGreaterThan(1);
  });

  it('parallel solid boosters: they burn out first, drop away, and the core burn then continues with less mass', () => {
    const { craft, root } = startCraft('par', 'pod-capsule');
    const tank = below(craft, root, 'tank-125-4');
    const engine = below(craft, tank, 'eng-sea-850');
    const decouplers = radial(craft, tank, 'dec-radial', 2, craft.parts.find((x) => x.id === tank)!.pos[1]);
    onDecoupler(craft, decouplers[0]!, 'srb-large'); // symmetry puts one on every decoupler
    finish(craft);
    expect(craft.parts.filter((x) => x.def === 'srb-large')).toHaveLength(2);
    const s = computeStats(craft);
    expect(s.stages).toHaveLength(2); // launch, then booster separation

    const boosters = 2 * (m('srb-large') + p('srb-large'));
    const core0 = m('pod-capsule') + m('tank-125-4') + p('tank-125-4') + m('eng-sea-850') + 2 * m('dec-radial');
    const mStart = core0 + boosters;
    near(s.stages[0]!.massStart, mStart);
    // Stage 0 includes the boosters' whole burn (they run dry before the core does) and part of the core's.
    expect(s.stages[0]!.dvVac).toBeGreaterThan(0);
    // After separation only the core remains: the dead boosters and decouplers are gone.
    expect(s.stages[1]!.massStart).toBeLessThan(s.stages[0]!.massStart - boosters * 0.1);
    // Total delta-v beats the core alone, which is the point of boosters.
    const { craft: alone, root: r2 } = startCraft('alone', 'pod-capsule');
    below(alone, below(alone, r2, 'tank-125-4'), 'eng-sea-850');
    finish(alone);
    expect(s.dvVac).toBeGreaterThan(computeStats(alone).dvVac);
    void engine;
  });

  it('no engines means no delta-v, but mass figures still work', () => {
    const { craft, root } = startCraft('tank only', 'tank-125-2');
    above(craft, root, 'cone-125');
    finish(craft);
    const s = computeStats(craft);
    expect(s.dvVac).toBe(0);
    expect(s.partCount).toBe(2);
    expect(s.wetMass).toBeGreaterThan(s.dryMass);
  });

  it('an engine with no propellant source contributes nothing', () => {
    const { craft, root } = startCraft('dry', 'pod-capsule');
    below(craft, root, 'eng-vacuum-110');
    finish(craft);
    expect(computeStats(craft).dvVac).toBe(0);
  });
});

describe('centres of mass and pressure', () => {
  it('centre of mass is the mass-weighted mean of the part positions', () => {
    const { craft, root } = startCraft('com', 'pod-capsule');
    const tank = below(craft, root, 'tank-125-2');
    below(craft, tank, 'eng-sea-850');
    finish(craft);
    const s = computeStats(craft);
    let sum = 0;
    let mass = 0;
    for (const part of craft.parts) {
      const d = partDef(part.def);
      const mm = d.dryMass + (d.propellant?.mass ?? 0);
      sum += mm * part.pos[1];
      mass += mm;
    }
    near(s.com![1], sum / mass);
    expect(s.com![1]).toBeLessThan(craft.parts[0]!.pos[1]);
  });

  it('fins move the centre of pressure down, making a tall rocket stable', () => {
    const { craft, root } = startCraft('fins', 'pod-capsule');
    const tank = below(craft, root, 'tank-125-4');
    below(craft, tank, 'eng-sea-850');
    finish(craft);
    const before = computeStats(craft);
    radial(craft, tank, 'fin-large', 4, craft.parts.find((x) => x.id === tank)!.pos[1] - 1.5);
    const after = computeStats(craft);
    expect(after.cop![1]).toBeLessThan(before.cop![1]);
    expect(after.stabilityMargin!).toBeGreaterThan(before.stabilityMargin!);
  });
});

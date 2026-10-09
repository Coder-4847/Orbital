import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/builder/examples';
import { Navigator } from '../src/flight/navigator';
import { Warp } from '../src/flight/warp';
import { navballMarkers, soundLevels, warpText } from '../src/scenes/flight-readouts';
import { advanceTime, PHYSICS_STEP } from '../src/scenes/flight-time';
import { worldAt } from './helpers/flight-env';

const LAT = (28.5 * Math.PI) / 180;
const KSC = { direction: [Math.cos(LAT), Math.sin(LAT), 0] as [number, number, number], headingDeg: 90 };

describe('advancing the simulation', () => {
  it('turns frame time into whole physics steps and keeps the remainder', () => {
    const w = worldAt();
    w.launch(EXAMPLES[0]!.build(), KSC);
    const nav = new Navigator(() => w);
    const warp = new Warp();
    const stepper = { accumulator: 0 };
    const t0 = w.ut;
    advanceTime(w, nav, warp, stepper, 1 / 60 + PHYSICS_STEP / 4, 0);
    // 2.25 steps' worth of time: two steps taken, a quarter step left over
    expect(w.ut - t0).toBeCloseTo(2 * PHYSICS_STEP, 9);
    expect(stepper.accumulator).toBeCloseTo(PHYSICS_STEP / 4, 9);
  });

  it('never runs away after a long stall: a hidden tab does not simulate minutes at once', () => {
    const w = worldAt();
    w.launch(EXAMPLES[0]!.build(), KSC);
    const nav = new Navigator(() => w);
    const stepper = { accumulator: 0 };
    const t0 = w.ut;
    advanceTime(w, nav, new Warp(), stepper, 120, 0);
    expect(w.ut - t0).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it('physics warp multiplies the time covered per frame', () => {
    const w = worldAt();
    w.launch(EXAMPLES[0]!.build(), KSC);
    const nav = new Navigator(() => w);
    const warp = new Warp();
    warp.index = 3; // 4x
    const t0 = w.ut;
    advanceTime(w, nav, warp, { accumulator: 0 }, 0.05, 0);
    expect(w.ut - t0).toBeCloseTo(0.2, 1);
  });
});

describe('flight readouts', () => {
  it('describes the warp state in words', () => {
    const w = new Warp();
    expect(warpText(w)).toBe('real time');
    w.index = 2;
    expect(warpText(w)).toBe('×3 physics');
    w.index = 6;
    expect(warpText(w)).toBe('×100 rails');
    w.warpTo(1e9);
    expect(warpText(w)).toMatch(/^warping ×100/);
  });

  it('puts six markers on the navball and a seventh while a maneuver is planned', () => {
    const f = { up: [0, 1, 0], east: [1, 0, 0], north: [0, 0, 1], prograde: [1, 0, 0], normal: [0, 0, 1], radialOut: [0, 1, 0] } as never;
    expect(navballMarkers(f, null).map((m) => m.kind)).toEqual(['prograde', 'retrograde', 'normal', 'antinormal', 'radialOut', 'radialIn']);
    const withNode = navballMarkers(f, [0, 0, 1]);
    expect(withNode).toHaveLength(7);
    expect(withNode[1]!.dir).toEqual([-1, -0, -0]);
    expect(withNode[6]!.kind).toBe('maneuver');
  });

  it('is silent on rails and louder the closer the camera is', () => {
    const w = worldAt();
    const v = w.launch(EXAMPLES[0]!.build(), KSC);
    v.tele.thrust = 2.5e6;
    const near = soundLevels(v, w.env, false, 'orbit', 10);
    const far = soundLevels(v, w.env, false, 'orbit', 5000);
    expect(near.level).toBeCloseTo(1, 6);
    expect(near.close).toBeGreaterThan(far.close);
    expect(far.close).toBeGreaterThanOrEqual(0.3);
    const rails = soundLevels(v, w.env, true, 'orbit', 10);
    expect([rails.level, rails.speed, rails.density]).toEqual([0, 0, 0]);
  });
});

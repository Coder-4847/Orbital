import { describe, expect, it } from 'vitest';
import { volumeToGain } from '../src/audio/audio-manager';
import { CHORDS, KEY_ROOT, midiToHz, nextChord, rng } from '../src/audio/music';
import { formatLength, formatSpeed } from '../src/core/units';
import { HINTS, nextHint, type HintId, type HintState } from '../src/flight/hints';
import { migrateSave } from '../src/save/saves';

describe('units', () => {
  it('formats metric distances and speeds', () => {
    expect(formatLength(850)).toBe('850.0 m');
    expect(formatLength(12_340)).toBe('12.3 km');
    expect(formatLength(3.84e8)).toBe('384,000 km');
    expect(formatLength(-5.36e6)).toBe('-5,360 km');
    expect(formatLength(2e11)).toBe('1.337 AU');
    expect(formatSpeed(42.5)).toBe('42.5 m/s');
    expect(formatSpeed(7790)).toBe('7.79 km/s');
  });

  it('formats imperial distances and speeds', () => {
    expect(formatLength(100, 'imperial')).toBe('328 ft');
    expect(formatLength(5000, 'imperial')).toBe('3.1 mi');
    expect(formatLength(400_000, 'imperial')).toBe('249 mi');
    expect(formatLength(1609.344 * 1500, 'imperial')).toBe('1,500 mi');
    expect(formatSpeed(10, 'imperial')).toBe('32.8 ft/s');
    expect(formatSpeed(7790, 'imperial')).toBe('4.84 mi/s');
  });
});

describe('audio levels', () => {
  it('maps the slider to gain monotonically, silent at zero and unity at full', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25, 6);
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(3)).toBe(1);
    for (let v = 0; v < 1; v += 0.05) expect(volumeToGain(v + 0.05)).toBeGreaterThan(volumeToGain(v));
  });
});

describe('the ambient music', () => {
  it('drifts between chords of the palette and always moves on', () => {
    const random = rng(7);
    let chord = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const next = nextChord(chord, random);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(CHORDS.length);
      expect(next).not.toBe(chord);
      seen.add(next);
      chord = next;
    }
    expect(seen.size).toBe(CHORDS.length); // every chord gets its turn
  });

  it('is repeatable for one seed and different for another', () => {
    const run = (seed: number) => {
      const r = rng(seed);
      let c = 0;
      return Array.from({ length: 20 }, () => (c = nextChord(c, r)));
    };
    expect(run(3)).toEqual(run(3));
    expect(run(3)).not.toEqual(run(4));
  });

  it('puts notes where they belong', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(KEY_ROOT)).toBeCloseTo(146.83, 1); // D3
    expect(midiToHz(81)).toBeCloseTo(880, 6);
  });
});

const base: HintState = {
  enabled: true,
  seen: new Set(),
  busy: false,
  bodyId: 'earth',
  situation: 'rest',
  met: 0,
  altitude: 5,
  agl: 2,
  speed: 0,
  verticalSpeed: 0,
  apoapsis: 5,
  periapsis: -6e6,
  atmosphereTop: 100_000,
  throttle: 0,
  thrust: 0,
  stageWaiting: true,
  hullHeat: 0,
  hasChutes: true,
  chutesArmed: false,
  hasLegs: false,
  legsOut: false,
  mapOpen: false,
  hasNode: false,
  nodeSoon: false,
  enteredSoi: false,
  atRealTime: true,
  everLiftedOff: false,
};
const state = (over: Partial<HintState>, seen: string[] = []): HintState => ({ ...base, ...over, seen: new Set(seen) });

describe('hints', () => {
  it('every hint has a title and some text', () => {
    for (const id of Object.keys(HINTS) as HintId[]) {
      expect(HINTS[id].title.length).toBeGreaterThan(2);
      expect(HINTS[id].text.length).toBeGreaterThan(20);
    }
  });

  it('says nothing when switched off or while another hint is showing, and never repeats', () => {
    expect(nextHint(state({ enabled: false }))).toBeNull();
    expect(nextHint(state({ busy: true }))).toBeNull();
    expect(nextHint(state({}))).toBe('pad');
    expect(nextHint(state({}, ['pad']))).toBeNull();
  });

  it('follows the flight: steering, empty stage, orbit, map, re-entry, parachutes', () => {
    const climbing = { situation: 'flying' as const, met: 40, altitude: 4000, agl: 4000, speed: 300, verticalSpeed: 200, everLiftedOff: true };
    expect(nextHint(state(climbing, ['pad']))).toBe('steer');
    expect(nextHint(state({ ...climbing, throttle: 1, thrust: 0, met: 90, speed: 10, verticalSpeed: 1 }, ['pad', 'steer']))).toBe('stage');
    expect(nextHint(state({ ...climbing, altitude: 95_000, apoapsis: 190_000, periapsis: -300_000, speed: 2500, verticalSpeed: 10, met: 400 }, ['pad', 'steer', 'stage']))).toBe('orbit');
    const orbit = { situation: 'flying' as const, altitude: 200_000, agl: 200_000, speed: 7790, verticalSpeed: 0, apoapsis: 201_000, periapsis: 199_000, everLiftedOff: true, met: 600 };
    expect(nextHint(state(orbit, ['pad', 'steer', 'stage', 'orbit']))).toBe('map');
    expect(nextHint(state({ ...orbit, mapOpen: true }, ['pad', 'map']))).toBe('node');
    expect(nextHint(state({ ...orbit, hullHeat: 0.5 }, ['pad', 'map']))).toBe('reentry');
    expect(nextHint(state({ ...orbit, altitude: 9000, agl: 9000, speed: 300, verticalSpeed: -120, periapsis: -5e6 }, ['pad', 'map', 'reentry']))).toBe('chutes');
  });

  it('knows about maneuvers, new spheres of influence and landings on airless worlds', () => {
    const orbit = { situation: 'flying' as const, altitude: 200_000, agl: 200_000, speed: 7790, apoapsis: 201_000, periapsis: 199_000, everLiftedOff: true, met: 600 };
    expect(nextHint(state({ ...orbit, hasNode: true, nodeSoon: true }, ['pad', 'map']))).toBe('burn');
    expect(nextHint(state({ ...orbit, enteredSoi: true }, ['pad']))).toBe('soi');
    const moon = { bodyId: 'moon', atmosphereTop: 0, situation: 'flying' as const, altitude: 1500, agl: 1500, speed: 60, verticalSpeed: -20, hasLegs: true, apoapsis: 1e5, periapsis: -1e6, everLiftedOff: true, met: 9000 };
    expect(nextHint(state(moon, ['pad', 'soi']))).toBe('legs');
    expect(nextHint(state({ ...moon, situation: 'rest', speed: 0, verticalSpeed: 0, agl: 2 }, ['pad', 'soi', 'legs']))).toBe('landed');
  });
});

describe('save migration', () => {
  it('runs every step from an old schema to the current one, in order', () => {
    const steps: Record<number, (d: unknown) => unknown> = {
      1: (d) => ({ ...(d as object), added: 'in-2' }),
      2: (d) => ({ ...(d as { added: string }), renamed: (d as { added: string }).added + '+3' }),
    };
    const rec = { schemaVersion: 1, data: { vessels: 1 } };
    const out = migrateSave(rec, steps, 3);
    expect(out.schemaVersion).toBe(3);
    expect(out.data).toEqual({ vessels: 1, added: 'in-2', renamed: 'in-2+3' });
  });

  it('refuses a save from a newer game and one with a missing step, with a readable message', () => {
    expect(() => migrateSave({ schemaVersion: 9, data: {} }, {}, 3)).toThrow(/newer version/);
    expect(() => migrateSave({ schemaVersion: 1, data: {} }, {}, 3)).toThrow(/No migration/);
  });
});

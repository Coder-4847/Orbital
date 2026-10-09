import { describe, expect, it } from 'vitest';
import { starterCraft } from '../src/builder/examples';
import { computeStats } from '../src/builder/stats';
import { altitudeOf } from '../src/flight/env';
import { ascentPitch, guide, GUIDE_COVERS, type GuideState } from '../src/flight/guide';
import { HINTS } from '../src/flight/hints';
import { clamp, qrot, vdot, vnorm } from '../src/flight/math3';
import { orbitInfo } from '../src/flight/orbit-info';
import { ACTIONS } from '../src/core/keymap';
import { worldAt } from './helpers/flight-env';

const base: GuideState = {
  enabled: true, seen: new Set(), busy: false, bodyId: 'earth', bodyName: 'Earth', situation: 'rest', met: 0,
  altitude: 12, agl: 8, speed: 0, verticalSpeed: 0, apoapsis: 12, periapsis: -6.36e6, atmosphereTop: 80_000,
  throttle: 0, thrust: 0, stageWaiting: true, hullHeat: 0, hasChutes: true, chutesArmed: false, hasLegs: false, legsOut: false,
  mapOpen: false, hasNode: false, nodeSoon: false, enteredSoi: false, atRealTime: true, everLiftedOff: false,
  pitchDeg: 90, timeToApoapsis: 0, reachedOrbit: false, fuelLeft: 1, orbitSpeed: 465, circularSpeed: 7900,
};
const at = (over: Partial<GuideState>) => guide({ ...base, ...over });
const flying: Partial<GuideState> = { situation: 'flying', everLiftedOff: true, throttle: 1, thrust: 8e5, met: 30 };

describe('flight guide', () => {
  it('walks a launch from the pad to orbit', () => {
    expect(at({}).id).toBe('throttle');
    expect(at({ throttle: 1 }).id).toBe('ignite');
    expect(at({ ...flying, altitude: 400, speed: 60, verticalSpeed: 60 }).id).toBe('climb');
    expect(at({ ...flying, altitude: 12_000, speed: 500, verticalSpeed: 400, pitchDeg: 80 }).id).toBe('turn');
    expect(at({ ...flying, altitude: 90_000, speed: 3000, verticalSpeed: 300, pitchDeg: 10, apoapsis: 150_000 }).id).toBe('speed');
    expect(at({ ...flying, altitude: 120_000, speed: 7600, apoapsis: 300_000, periapsis: 86_000 }).id).toBe('orbit');
  });

  it('tells the player which way to tip the nose, and when to leave it alone', () => {
    const high = at({ ...flying, altitude: 10_000, speed: 400, verticalSpeed: 350, pitchDeg: 85 });
    expect(high.text).toContain('{pitchUp}');
    expect(high.text).toContain('60°');
    expect(at({ ...flying, altitude: 10_000, speed: 400, verticalSpeed: 350, pitchDeg: 40 }).text).toContain('{pitchDown}');
    expect(at({ ...flying, altitude: 10_000, speed: 400, verticalSpeed: 350, pitchDeg: 62 }).text).toContain('Hands off');
    expect(at({ ...flying, altitude: 90_000, speed: 3000, verticalSpeed: -40, pitchDeg: 5 }).text).toContain('sinking');
  });

  it('notices burnout, empty tanks and an engine left off', () => {
    expect(at({ ...flying, altitude: 60_000, thrust: 0, stageWaiting: true }).id).toBe('stage');
    expect(at({ ...flying, altitude: 60_000, thrust: 0, stageWaiting: false }).id).toBe('spent');
    expect(at({ ...flying, altitude: 20_000, throttle: 0, thrust: 0, pitchDeg: 45 }).text).toContain('The engine is off');
    expect(at({ ...flying, altitude: 90_000, pitchDeg: 10, fuelLeft: 0.05 }).text).toContain('Fuel is almost gone');
    expect(at({ ...flying, altitude: 90_000, pitchDeg: 10, fuelLeft: 0.5 }).text).not.toContain('Fuel is almost gone');
  });

  it('brings the player home once they have been in orbit', () => {
    const back: Partial<GuideState> = { ...flying, throttle: 0, thrust: 0, reachedOrbit: true, apoapsis: 300_000, periapsis: 30_000 };
    expect(at({ ...back, altitude: 200_000, speed: 7700 }).id).toBe('deorbit');
    expect(at({ ...back, altitude: 60_000, speed: 7000, verticalSpeed: -200 }).id).toBe('reentry');
    expect(at({ ...back, altitude: 9000, agl: 9000, speed: 250, verticalSpeed: -200 }).id).toBe('chutes');
    expect(at({ ...back, altitude: 4000, agl: 4000, speed: 60, verticalSpeed: -50, chutesArmed: true }).id).toBe('descent');
    expect(at({ ...back, altitude: 800, agl: 800, speed: 15, verticalSpeed: -10, hasChutes: false }).id).toBe('descent');
    expect(at({ ...back, situation: 'rest', altitude: 3, agl: 0, speed: 0 }).id).toBe('landed');
  });

  it('explains the underground periapsis and shows speed progress while gaining speed', () => {
    const burn: Partial<GuideState> = { ...flying, altitude: 100_000, verticalSpeed: 100, pitchDeg: 0, apoapsis: 106_000, periapsis: -5_400_000, orbitSpeed: 4000, circularSpeed: 7800 };
    const v = at(burn);
    expect(v.id).toBe('speed');
    expect(v.text).toContain('underground');
    expect(v.status).toBe('Speed 4.0 km/s of 7.8 km/s');
    expect(v.progress).toBeCloseTo(4000 / 7800, 3);
    const late = at({ ...burn, periapsis: 40_000, orbitSpeed: 7600 });
    expect(late.text).not.toContain('underground');
    expect(late.status).toContain('Periapsis 40 km of 85 km');
  });

  it('has something to say near other bodies', () => {
    const v = at({ ...flying, bodyId: 'moon', bodyName: 'the Moon', atmosphereTop: 0 });
    expect(v.id).toBe('away');
    expect(v.phases).toBeNull();
    expect(v.title).toContain('Moon');
  });

  it('only names actions and hints that exist', () => {
    const ids = new Set<string>(ACTIONS.map((a) => a.id));
    const states: Array<Partial<GuideState>> = [
      {}, { throttle: 1 }, { ...flying, altitude: 400 }, { ...flying, altitude: 12_000, pitchDeg: 80 }, { ...flying, altitude: 12_000, pitchDeg: 20 },
      { ...flying, altitude: 90_000, pitchDeg: 10 }, { ...flying, altitude: 90_000, thrust: 0 }, { ...flying, altitude: 90_000, thrust: 0, stageWaiting: false },
      { ...flying, periapsis: 90_000, apoapsis: 200_000, altitude: 100_000 }, { ...flying, reachedOrbit: true, altitude: 200_000 }, { ...flying, reachedOrbit: true, altitude: 50_000 },
      { ...flying, altitude: 9000, agl: 9000, speed: 200, verticalSpeed: -100 }, { ...flying, altitude: 4000, verticalSpeed: -50, chutesArmed: true },
      { situation: 'rest', everLiftedOff: true }, { bodyId: 'moon' }, { bodyId: 'moon', situation: 'flying' },
    ];
    for (const s of states) for (const m of at(s).text.matchAll(/\{(\w+)\}/g)) expect(ids.has(m[1]!), m[1]).toBe(true);
    for (const id of GUIDE_COVERS) expect(id in HINTS, id).toBe(true);
  });

  it('gives a pitch that only ever comes down through the air', () => {
    let last = 90;
    for (let alt = 0; alt < 55_000; alt += 500) {
      const p = ascentPitch(alt, 300);
      expect(p).toBeLessThanOrEqual(last);
      last = p;
    }
    expect(ascentPitch(500, 100)).toBe(90);
    expect(ascentPitch(10_000, 300)).toBe(60);
    // up high the nose holds the altitude: down while climbing fast, up when sinking
    expect(ascentPitch(90_000, -10)).toBeGreaterThan(ascentPitch(90_000, 600));
    expect(ascentPitch(110_000, 0)).toBeLessThanOrEqual(10);
    expect(ascentPitch(80_000, 900)).toBe(-5); // still climbing hard: the nose goes just below the horizon
  });
});

const LAT = (28.5 * Math.PI) / 180;
const KSC = { direction: [Math.cos(LAT), Math.sin(LAT), 0] as [number, number, number], headingDeg: 90 };

/**
 * A clumsy player following the guide: looks at the screen every `react` seconds and, if the nose is more than `band` degrees
 * from what the guide says, taps the key for `tap` seconds. Stages at burnout, cuts the engine when the periapsis is up.
 */
function flyByGuide(band: number, react: number, tap: number): { orbit: boolean; periapsis: number; fuel: number; why: string } {
  const w = worldAt();
  const v = w.launch(starterCraft(), KSC);
  const dt = 1 / 120;
  v.throttle = 1;
  v.sas.enabled = true;
  v.sas.mode = 'stability';
  w.stage();
  let input = 0;
  let nextLook = 0;
  let tapEnd = 0;
  for (let t = 0; t < 900; t += dt) {
    w.step(dt);
    const a = w.active;
    if (!a) return { orbit: false, periapsis: 0, fuel: 0, why: `lost at ${t.toFixed(0)} s` };
    const alt = altitudeOf(w.env, a.pos);
    const up = vnorm(a.pos);
    const elevation = (Math.asin(clamp(vdot(qrot(a.q, [0, 1, 0]), up), -1, 1)) * 180) / Math.PI;
    const vs = vdot(a.vel, up);
    if (t >= nextLook) {
      nextLook = t + react;
      const err = elevation - ascentPitch(alt, vs);
      input = alt < 1000 ? 0 : err > band ? 1 : err < -band ? -1 : 0;
      tapEnd = t + tap * (Math.abs(err) > 3 * band ? 3 : 1);
    }
    a.controls.pitch = t < tapEnd ? input : 0;
    if (a.tele.thrust === 0 && a.throttle > 0 && a.parts.some((p) => p.stage >= a.nextStage && p.def.engine)) w.stage();
    const o = orbitInfo(a.pos, a.vel, w.env.mu, w.env.radius);
    if (o.periapsis > 85_000) return { orbit: true, periapsis: o.periapsis, fuel: a.parts.reduce((s, p) => s + p.fuel, 0), why: '' };
    if (alt < 30_000 && vs < -50) return { orbit: false, periapsis: o.periapsis, fuel: 0, why: `fell back at ${t.toFixed(0)} s` };
  }
  return { orbit: false, periapsis: 0, fuel: 0, why: 'timeout' };
}

describe('the starter rocket and the guide together', () => {
  it('the starter rocket is forgiving on paper', () => {
    const s = computeStats(starterCraft());
    expect(s.twrSL).toBeGreaterThan(1.15);
    expect(s.twrSL).toBeLessThan(1.8);
    expect(s.dvVac).toBeGreaterThan(10_500);
    expect(s.stabilityMargin ?? 0).toBeGreaterThan(0);
  });

  it.each([
    ['a careful player', 4, 0.4, 0.15],
    ['an average player', 6, 0.6, 0.25],
    ['a slow, heavy-handed player', 10, 1.5, 0.25],
  ])('%s following the guide reaches orbit with plenty of fuel left', (_name, band, react, tap) => {
    const out = flyByGuide(band, react, tap);
    expect(out.why).toBe('');
    expect(out.orbit).toBe(true);
    expect(out.fuel).toBeGreaterThan(2000); // several tonnes to spare, so a bad launch is still a recoverable one
  }, 120_000);
});

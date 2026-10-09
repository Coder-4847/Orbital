import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/builder/examples';
import { orbitInfo } from '../src/flight/orbit-info';
import { vlen } from '../src/flight/math3';
import { flyAscent } from './helpers/autopilot';
import { run } from './helpers/flight-env';
import { EARTH_R, worldAt } from './helpers/flight-env';

const LAT = (28.5 * Math.PI) / 180;
const KSC = { direction: [Math.cos(LAT), Math.sin(LAT), 0] as [number, number, number], headingDeg: 90 };

describe('orbit info', () => {
  it('reads a circular orbit', () => {
    const r = EARTH_R + 400_000;
    const v = Math.sqrt(3.986004418e14 / r);
    const o = orbitInfo([r, 0, 0], [0, 0, v], 3.986004418e14, EARTH_R);
    expect(o.bound).toBe(true);
    expect(o.apoapsis).toBeCloseTo(400_000, -1);
    expect(o.periapsis).toBeCloseTo(400_000, -1);
    expect(o.period / 60).toBeGreaterThan(92);
    expect(o.period / 60).toBeLessThan(93.5);
  });
});

describe('a launch to orbit under player controls', () => {
  it('the Sparrow-1 example reaches a stable low Earth orbit', () => {
    const w = worldAt();
    const v = w.launch(EXAMPLES[0]!.build(), KSC);
    const out = flyAscent(w, v, { target: 110_000 });
    const a = out.v;
    const o = orbitInfo(a.pos, a.vel, w.env.mu, w.env.radius);
    expect(out.phase).toBe('orbit');
    expect(o.bound).toBe(true);
    expect(o.periapsis).toBeGreaterThan(80_000);
    expect(o.apoapsis).toBeLessThan(260_000);
    expect(a.maxQ).toBeLessThan(60_000); // max-Q stayed sane
    expect(Math.max(...out.log.map((l) => l.stress))).toBeLessThan(0.8); // nothing came close to breaking
    expect(vlen(a.pos) - EARTH_R).toBeGreaterThan(80_000);
    expect(a.parts.some((p) => p.def.category === 'command')).toBe(true);
  }, 120_000);
});

describe('the Selene Moon rocket', () => {
  it('lifts a 950 t stack off the pad and puts the Moon module in a stable orbit with its own propellant untouched', () => {
    const w = worldAt();
    const v = w.launch(EXAMPLES.find((e) => e.id === 'selene')!.build(), KSC);
    const out = flyAscent(w, v, { target: 190_000, kickAlt: 600, maxSeconds: 1500 });
    expect(out.phase).toBe('orbit');
    const a = out.v;
    const info = () => orbitInfo(a.pos, a.vel, w.env.mu, w.env.radius);
    // coast to apoapsis and circularise with the upper stage
    const dt = 1 / 120;
    a.sas.enabled = true;
    a.sas.mode = 'prograde';
    a.throttle = 0;
    for (let t = 0; t < 4000 && info().timeToApoapsis > 25; t += dt) w.step(dt);
    for (let t = 0; t < 1200; t += dt) {
      w.step(dt);
      a.throttle = info().periapsis > 150_000 ? 0 : 1;
      if (a.throttle === 0 || (t > 3 && a.tele.thrust === 0)) break;
    }
    const o = info();
    expect(o.bound).toBe(true);
    expect(o.periapsis).toBeGreaterThan(120_000);
    const moduleFuel = a.parts.filter((p) => ['tank-125-2', 'tank-125-4', 'tank-250-4', 'tank-250-2'].includes(p.def.id)).reduce((s, p) => s + p.fuel, 0);
    expect(moduleFuel).toBeGreaterThan(20_000); // enough left in the Moon module for the trip
    expect(a.parts.some((p) => p.def.category === 'command')).toBe(true);
  }, 600_000);
});

describe('a badly designed rocket fails in believable ways', () => {
  it('without fins or guidance a small disturbance grows into a tumble and the rocket breaks up', () => {
    const craft = EXAMPLES[0]!.build();
    craft.parts = craft.parts.filter((p) => p.def !== 'fin-large');
    const w = worldAt();
    const v = w.launch(craft, KSC);
    v.throttle = 1;
    w.stage();
    run(w, 6);
    v.controls.pitch = 0.3; // a nudge, as a pilot overcorrecting would give
    run(w, 1);
    v.controls.pitch = 0;
    let worstAoa = 0;
    const dt = 1 / 120;
    for (let t = 0; t < 70 && w.active === v; t += dt) {
      w.step(dt);
      worstAoa = Math.max(worstAoa, v.tele.aoa);
    }
    const lostParts = w.vessels.length > 1 || v.log.some((l) => /Structural failure|Crash/.test(l));
    expect(worstAoa).toBeGreaterThan(0.6);
    expect(lostParts).toBe(true);
  }, 120_000);

  it('a rocket with too little thrust never leaves the pad even though its engine burns', () => {
    const craft = EXAMPLES[0]!.build();
    for (const p of craft.parts) if (p.def === 'tank-250-4') p.fill = 1;
    craft.parts.push(...[]);
    const w = worldAt();
    const v = w.launch(craft, KSC);
    v.parts.find((p) => p.def.id === 'eng-sea-850')!.dry += 80_000; // an absurdly heavy engine
    v.throttle = 1;
    w.stage();
    run(w, 10);
    expect(v.situation).toBe('rest');
  });
});

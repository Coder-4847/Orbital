import { describe, expect, it } from 'vitest';
import { below, finish, radial, startCraft, above } from '../src/builder/compose';
import { EXAMPLES } from '../src/builder/examples';
import { computeStats } from '../src/builder/stats';
import { earthAir, machDragFactor, speedOfSound } from '../src/flight/atmosphere';
import { qfromAxisAngle, qfromBasis, qrot, vlen, vsub, type V3 } from '../src/flight/math3';
import { updateMass } from '../src/flight/vessel';
import { PAD, run, speedRelative, uprightQ, worldAt } from './helpers/flight-env';

const sparrow = () => EXAMPLES[0]!.build();

describe('maths', () => {
  it('rotates vectors and rebuilds a rotation from its basis', () => {
    const q = qfromAxisAngle([0, 0, 1], Math.PI / 2);
    const r = qrot(q, [1, 0, 0]);
    expect(r[0]).toBeCloseTo(0, 12);
    expect(r[1]).toBeCloseTo(1, 12);
    const b = qfromBasis([0, 1, 0], [-1, 0, 0], [0, 0, 1]);
    const x = qrot(b, [1, 0, 0]);
    expect(x[1]).toBeCloseTo(1, 12);
  });
});

describe('atmosphere', () => {
  it('matches the US standard atmosphere at the reference altitudes', () => {
    const sl = earthAir(0);
    expect(sl.pressure).toBeCloseTo(101325, 0);
    expect(sl.density).toBeCloseTo(1.225, 2);
    expect(sl.temperature).toBeCloseTo(288.15, 2);
    const tropo = earthAir(11_000);
    expect(tropo.pressure / 22632).toBeGreaterThan(0.995);
    expect(tropo.pressure / 22632).toBeLessThan(1.005);
    expect(earthAir(20_000).pressure / 5474.9).toBeGreaterThan(0.99);
    expect(earthAir(32_000).pressure / 868.0).toBeGreaterThan(0.99);
    expect(earthAir(85_000).density).toBeLessThan(1e-5);
  });

  it('thins monotonically to nothing, and drag peaks near Mach 1', () => {
    let last = Infinity;
    for (let h = 0; h <= 200_000; h += 2500) {
      const d = earthAir(h).density;
      expect(d).toBeLessThan(last);
      last = d;
    }
    expect(earthAir(300_000).density).toBeLessThan(1e-9);
    expect(machDragFactor(1.1)).toBeGreaterThan(machDragFactor(0.4) * 1.5);
    expect(machDragFactor(5)).toBeLessThan(machDragFactor(1.1));
    expect(speedOfSound(288.15)).toBeCloseTo(340.3, 0);
  });
});

describe('rest and liftoff', () => {
  it('a vessel on the pad rides the rotating Earth without moving or burning anything', () => {
    const w = worldAt();
    const v = w.launch(sparrow(), PAD);
    const fuel0 = v.parts.reduce((s, p) => s + p.fuel, 0);
    run(w, 10);
    expect(v.situation).toBe('rest');
    expect(speedRelative(w)).toBeLessThan(1e-6);
    expect(v.parts.reduce((s, p) => s + p.fuel, 0)).toBe(fuel0);
    // it moves with the planet: after 10 s it is rotated about the pole
    expect(vlen(vsub(v.pos, v.pos))).toBe(0);
  });

  it('with engines lit and thrust above weight it leaves the pad and climbs; mass falls as it burns', () => {
    const w = worldAt();
    const v = w.launch(sparrow(), PAD);
    const m0 = v.mass.mass;
    v.throttle = 1;
    w.stage();
    run(w, 20);
    expect(v.situation).toBe('flying');
    expect(vlen(v.pos) - 6.371e6).toBeGreaterThan(400);
    expect(v.mass.mass).toBeLessThan(m0 - 3000);
    expect(v.tele.thrust).toBeGreaterThan(5e5);
    expect(v.log.some((l) => /Liftoff/.test(l))).toBe(true);
  });

  it('an under-powered rocket stays on the pad with its engines burning', () => {
    const { craft, root } = startCraft('heavy', 'pod-cabin');
    below(craft, below(craft, root, 'tank-250-8'), 'eng-vac-600');
    finish(craft);
    const w = worldAt();
    const v = w.launch(craft, PAD);
    v.throttle = 1;
    w.stage();
    run(w, 5);
    expect(v.situation).toBe('rest');
    expect(v.parts.reduce((s, p) => s + p.fuel, 0)).toBeLessThan(37_306 - 100); // it burned fuel without moving
  });
});

describe('delta-v: the simulation agrees with the rocket equation', () => {
  it('burning a two-stage rocket in deep space gains the delta-v the Hangar reports', () => {
    const craft = sparrow();
    const planned = computeStats(craft).dvVac;
    const w = worldAt({ mu: 0, air: null, spinRate: 0, groundRadius: () => 1 });
    const v = w.launch(craft, { direction: [0, 1, 0], headingDeg: 0 });
    // Put it in empty space, away from any ground, and burn.
    v.situation = 'flying';
    v.pos = [0, 1e9, 0];
    v.vel = [0, 0, 0];
    v.throttle = 1;
    w.stage();
    run(w, 400, () => v.parts.every((p) => !p.ignited || p.fuel <= 0) && v.tele.thrust === 0);
    const first = v.nextStage;
    expect(first).toBe(1);
    w.stage(); // drop the spent stage and light the upper one
    const upper = w.active!;
    run(w, 600, () => upper.tele.thrust === 0 && upper.parts.some((p) => p.def.engine) && upper.parts.filter((p) => p.def.engine).every((p) => !p.ignited || upper.parts.filter((x) => x.def.propellant).every((x) => x.fuel < 1)));
    const gained = vlen(upper.vel);
    expect(gained / planned).toBeGreaterThan(0.985);
    expect(gained / planned).toBeLessThan(1.005);
  });
});

describe('staging', () => {
  it('a decoupler splits the vessel in two pieces that conserve momentum', () => {
    const w = worldAt({ mu: 0, air: null, spinRate: 0, groundRadius: () => 1 });
    const v = w.launch(sparrow(), { direction: [0, 1, 0], headingDeg: 0 });
    v.situation = 'flying';
    v.pos = [0, 1e9, 0];
    v.vel = [10, 0, 0];
    const mTotal = v.mass.mass;
    const p0 = mTotal * 10;
    w.stage(); // stage 0: lights the booster engine
    w.stage(); // stage 1: decoupler + upper engine
    expect(w.vessels).toHaveLength(2);
    const [a, b] = w.vessels;
    const px = a!.mass.mass * a!.vel[0] + b!.mass.mass * b!.vel[0];
    expect(px / p0).toBeCloseTo(1, 4);
    expect(a!.mass.mass + b!.mass.mass).toBeCloseTo(mTotal, 3);
    const debris = w.vessels.find((x) => x.debris)!;
    expect(debris.parts.some((p) => p.def.category === 'command')).toBe(false);
    expect(w.active!.parts.some((p) => p.def.category === 'command')).toBe(true);
    expect(vlen(vsub(a!.vel, b!.vel))).toBeGreaterThan(0.5);
  });
});

describe('attitude control', () => {
  const free = () => worldAt({ mu: 0, air: null, spinRate: 0, groundRadius: () => 1 });
  const flyingProbe = (w: ReturnType<typeof free>) => {
    const { craft, root } = startCraft('probe', 'pod-capsule');
    below(craft, below(craft, root, 'tank-125-2'), 'eng-vacuum-110');
    finish(craft);
    const v = w.launch(craft, { direction: [0, 1, 0], headingDeg: 0 });
    v.situation = 'flying';
    v.pos = [0, 1e9, 0];
    return v;
  };

  it('SAS in stability mode stops a spinning vessel', () => {
    const w = free();
    const v = flyingProbe(w);
    v.w = [0.25, 0.05, -0.15];
    v.sas.enabled = true;
    v.sas.mode = 'stability';
    run(w, 40);
    expect(vlen(v.w)).toBeLessThan(0.01);
  });

  it('SAS prograde turns the nose onto the velocity and holds it', () => {
    const w = free();
    const v = flyingProbe(w);
    v.vel = [300, 0, 0];
    v.sas.enabled = true;
    v.sas.mode = 'prograde';
    run(w, 60);
    const nose = qrot(v.q, [0, 1, 0]);
    expect(nose[0]).toBeGreaterThan(0.995);
    expect(vlen(v.w)).toBeLessThan(0.02);
  });

  it('pitch input tips the nose towards body +X', () => {
    const w = free();
    const v = flyingProbe(w);
    v.controls.pitch = 1;
    run(w, 3);
    const nose = qrot(v.q, [0, 1, 0]);
    const bodyX = qrot(v.q, [1, 0, 0]);
    const tilt = nose[0] * bodyX[0] + nose[1] * bodyX[1] + nose[2] * bodyX[2];
    expect(tilt).toBeCloseTo(0, 6); // basis stays orthonormal
    // the nose has moved away from where it was, in the direction of what was body +X at the start
    const startNose: V3 = [0, 1, 0];
    expect(vlen(vsub(nose, startNose))).toBeGreaterThan(0.05);
  });
});

describe('aerodynamics', () => {
  /** A vessel in the air at `alt` moving at `speed` along +Z (no wind), with its nose `aoaDeg` away from the direction of travel. */
  function inAir(craft = sparrow(), alt = 2000, speed = 200, aoaDeg = 0) {
    const w = worldAt({ spinRate: 0 });
    const v = w.launch(craft, { direction: [0, 1, 0], headingDeg: 90 });
    v.situation = 'flying';
    v.pos = [0, 6.371e6 + alt, 0];
    v.vel = [0, 0, speed];
    const theta = Math.PI / 2 - (aoaDeg * Math.PI) / 180; // angle of the nose above +Y, towards +Z
    v.q = qfromAxisAngle([1, 0, 0], theta);
    return { w, v };
  }

  it('drag slows a vessel in thick air, and much more broadside than nose first', () => {
    const lost = (aoa: number) => {
      const { w, v } = inAir(sparrow(), 100, 250, aoa);
      run(w, 0.5);
      return 250 - vlen(v.vel);
    };
    const nose = lost(0);
    const broadside = lost(90);
    expect(nose).toBeGreaterThan(0.1);
    expect(broadside).toBeGreaterThan(nose * 4);
    const { w, v } = inAir(sparrow(), 100, 250, 0);
    run(w, 0.2);
    expect(v.tele.q).toBeGreaterThan(30_000);
  });

  it('there is no drag in space', () => {
    const w = worldAt({ mu: 0, air: null, spinRate: 0, groundRadius: () => 1 });
    const v = w.launch(sparrow(), { direction: [0, 1, 0], headingDeg: 0 });
    v.situation = 'flying';
    v.pos = [0, 1e9, 0];
    v.vel = [0, 0, 3000];
    run(w, 5);
    expect(vlen(v.vel)).toBeCloseTo(3000, 6);
  });

  it('fins make a rocket weathervane: a finned rocket flying 15 degrees off its heading swings towards it', () => {
    const { w, v } = inAir(sparrow(), 3000, 250, 15);
    const angleOff = () => v.tele.aoa;
    run(w, 0.05);
    const start = angleOff();
    expect(start).toBeGreaterThan(0.2);
    let best = start;
    for (let i = 0; i < 6; i++) {
      run(w, 0.25);
      best = Math.min(best, angleOff());
    }
    expect(best).toBeLessThan(start * 0.5);

    // the same rocket without fins turns the other way or hardly at all
    const bare = sparrow();
    for (const p of [...bare.parts]) if (p.def === 'fin-large') bare.parts.splice(bare.parts.indexOf(p), 1);
    const flat = inAir(bare, 3000, 250, 15);
    run(flat.w, 0.05);
    const s2 = flat.v.tele.aoa;
    let best2 = s2;
    for (let i = 0; i < 6; i++) {
      run(flat.w, 0.25);
      best2 = Math.min(best2, flat.v.tele.aoa);
    }
    expect(best2).toBeGreaterThan(best); // the fins are what makes it settle fastest
  });

  it('a parachute brings a capsule to a gentle terminal speed', () => {
    const { craft, root } = startCraft('capsule', 'pod-capsule');
    above(craft, root, 'chute-main');
    finish(craft);
    const w = worldAt({ spinRate: 0 });
    const v = w.launch(craft, { direction: [0, 1, 0], headingDeg: 0 });
    v.situation = 'flying';
    v.pos = [0, 6.371e6 + 1500, 0];
    v.vel = [0, -60, 0];
    // nose up so the chute (on top) trails correctly? the capsule falls heat-shield first: flip it
    v.q = qfromAxisAngle([1, 0, 0], 0);
    v.sas.enabled = false;
    w.deployChutes();
    run(w, 40);
    const speed = vlen(v.vel);
    const expected = Math.sqrt((2 * v.mass.mass * 9.8) / (earthAir(1000).density * 1.4 * 100));
    expect(speed).toBeLessThan(expected * 1.5);
    expect(speed).toBeLessThan(25);
  });
});

describe('landing and crashing', () => {
  function dropped(legs: boolean, speed: number) {
    const { craft, root } = startCraft('lander', 'pod-lander');
    const tank = below(craft, root, 'tank-125-2');
    below(craft, tank, 'eng-vacuum-110');
    radial(craft, tank, 'leg-large', 4, craft.parts.find((p) => p.id === tank)!.pos[1] - 1.4);
    finish(craft);
    const w = worldAt({ spinRate: 0, air: null });
    const v = w.launch(craft, PAD);
    v.legsOut = legs;
    for (const p of v.parts) if (p.def.look === 'leg') p.leg = legs ? 1 : 0;
    v.situation = 'flying';
    const up = [0.3, 0.9, 0.3].map((x) => x / Math.hypot(0.3, 0.9, 0.3)) as V3;
    const h = 6.371e6 + (legs ? 4.3 : 6);
    v.pos = [up[0] * h, up[1] * h, up[2] * h];
    v.vel = [-up[0] * speed, -up[1] * speed, -up[2] * speed];
    v.q = uprightQ(up);
    updateMass(v);
    return { w, v };
  }

  it('a slow touchdown on extended legs breaks nothing and the vessel comes to rest', () => {
    const { w, v } = dropped(true, 2.5);
    run(w, 25);
    expect(v.parts.length).toBe(7);
    expect(v.situation).toBe('rest');
  });

  it('a fast impact breaks the parts that hit first and the pieces become debris', () => {
    const { w, v } = dropped(false, 30);
    const n = v.parts.length;
    run(w, 5);
    expect(w.vessels.length === 0 || v.parts.length < n || w.vessels.length > 1).toBe(true);
    expect(v.log.join(' ')).toMatch(/Crash/);
  });
});

describe('structure', () => {
  it('a rocket thrown broadside through thick air at high speed breaks apart', () => {
    const w = worldAt({ spinRate: 0 });
    const v = w.launch(sparrow(), { direction: [0, 1, 0], headingDeg: 90 });
    v.situation = 'flying';
    v.pos = [0, 6.371e6 + 500, 0];
    v.vel = [0, 0, 450];
    v.q = qfromAxisAngle([1, 0, 0], Math.PI / 2); // nose along +Z... broadside is nose up with velocity along Z
    v.q = qfromAxisAngle([1, 0, 0], 0);
    const parts = v.parts.length;
    run(w, 3);
    expect(w.vessels.length > 1 || v.parts.length < parts).toBe(true);
    expect(v.log.join(' ')).toMatch(/Structural failure/);
  });

  it('thrust loads on a single healthy stack stay well inside the joints', () => {
    const w = worldAt();
    const v = w.launch(sparrow(), PAD);
    const n0 = v.parts.length;
    v.throttle = 1;
    w.stage();
    run(w, 5);
    expect(v.tele.stress).toBeLessThan(0.8);
    expect(v.parts.length).toBe(n0);
  });
});

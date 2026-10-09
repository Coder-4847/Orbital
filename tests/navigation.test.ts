import { describe, expect, it } from 'vitest';
import { below, finish, startCraft } from '../src/builder/compose';
import { EXAMPLES } from '../src/builder/examples';
import { bodyDef } from '../src/data/solar-system';
import { bodyFlightEnv, sphereHost } from '../src/flight/body-env';
import { earthAir } from '../src/flight/atmosphere';
import { FlightWorld } from '../src/flight/flight-world';
import { heatVessel } from '../src/flight/heating';
import { Navigator } from '../src/flight/navigator';
import { buildVessel } from '../src/flight/vessel';
import { Warp, MAX_PHYSICS_INDEX } from '../src/flight/warp';
import { Ephemeris } from '../src/physics/ephemeris';
import { length, propagate, sub, type Vec3 } from '../src/physics/kepler';

const UT = 8.0e8;
const earth = bodyDef('earth');
const MU = earth.gm;

function makeWorld(body = 'earth', ut = UT) {
  const eph = new Ephemeris();
  const host = sphereHost(eph);
  const world = new FlightWorld(bodyFlightEnv(host, body), ut, host);
  const nav = new Navigator(() => world);
  return { eph, host, world, nav };
}

const craft = () => EXAMPLES[0]!.build();

describe('rails warp', () => {
  it('moves the vessel along its Kepler orbit and leaves the cached prediction valid', () => {
    const { world, nav } = makeWorld();
    const r = earth.radius + 400_000;
    const start = { r: [r, 0, 0] as Vec3, v: [0, 0, Math.sqrt(MU / r)] as Vec3 };
    const v = world.spawn(craft(), start.r, start.v, [0, 0, 1]);
    nav.refresh(0, 0, true);
    const version = world.version;
    expect(nav.railsBlocker()).toBeNull();
    const result = nav.advanceRails(86_400, 1);
    expect(result.stopped).toBeNull();
    const expected = propagate(start, MU, 86_400);
    expect(length(sub(v.pos, expected.r))).toBeLessThan(1e-3);
    expect(length(sub(v.vel, expected.v))).toBeLessThan(1e-6);
    expect(world.ut).toBeCloseTo(UT + 86_400, 6);
    expect(world.version).toBe(version);
    expect(Math.abs(length(v.pos) - r)).toBeLessThan(1);
  });

  it('stops where the orbit reaches the air, and then refuses to warp', () => {
    const { world, nav } = makeWorld();
    const r = earth.radius + 300_000;
    const v = world.spawn(craft(), [r, 0, 0], [0, 0, 0.9 * Math.sqrt(MU / r)], [0, 0, 1]);
    nav.refresh(0, 0, true);
    const result = nav.advanceRails(6 * 3600, 1);
    expect(result.stopped).toBe('floor');
    expect(length(v.pos) - earth.radius).toBeCloseTo(world.env.railsFloor!, -1);
    expect(world.ut - UT).toBeLessThan(6 * 3600);
    expect(nav.railsBlocker()).toMatch(/too low/i);
  });

  it('hands the vessel over to the Moon and back, keeping its heliocentric state', () => {
    const { eph, world, nav } = makeWorld();
    // a path found by running a state backwards from the Moon's sphere of influence
    const tEnc = UT + 3 * 86400;
    const m = eph.relative('moon', tEnc);
    const u = m.pos.map((x) => x / length(m.pos)) as Vec3;
    const dir = m.vel.map((x) => x / length(m.vel)) as Vec3;
    const inside: Vec3 = [m.pos[0] - 4.5e7 * u[0], m.pos[1] - 4.5e7 * u[1], m.pos[2] - 4.5e7 * u[2]];
    const vel: Vec3 = [u[0] * 1000 + dir[0] * 400, u[1] * 1000 + dir[1] * 400, u[2] * 1000 + dir[2] * 400];
    const start = propagate({ r: inside, v: vel }, MU, -2 * 86400);
    world.ut = tEnc - 2 * 86400;
    world.env.update!(world.ut);
    const v = world.spawn(craft(), start.r, start.v, [0, 0, 1]);
    nav.refresh(0, 0, true);
    expect(nav.trajectory!.patches[0]!.end).toBe('soi-enter');

    const entered: string[] = [];
    for (let i = 0; i < 40 && entered.length < 2; i++) {
      const r = nav.advanceRails(86_400 / 4, i);
      if (r.entered) entered.push(r.entered);
      if (r.stopped) break;
    }
    expect(entered[0]).toBe('moon');
    expect(world.events.some((e) => e.kind === 'soi')).toBe(true);
    if (entered.length > 1) expect(entered[1]).toBe('earth');
    expect(v.situation).toBe('flying');
  });

  it('switching body preserves the vessel heliocentric position and velocity exactly', () => {
    const { eph, world } = makeWorld();
    const v = world.spawn(craft(), [4e8, 1e7, -2e7], [200, -1000, 300], [0, 1, 0]);
    const helio = (id: string) => {
      const b = eph.stateAt(id, world.ut);
      return { p: [b.pos[0] + v.pos[0], b.pos[1] + v.pos[1], b.pos[2] + v.pos[2]] as Vec3, v: [b.vel[0] + v.vel[0], b.vel[1] + v.vel[1], b.vel[2] + v.vel[2]] as Vec3 };
    };
    const before = helio('earth');
    world.switchBody('moon');
    expect(world.bodyId).toBe('moon');
    const after = helio('moon');
    expect(length(sub(before.p, after.p))).toBeLessThan(1e-3);
    expect(length(sub(before.v, after.v))).toBeLessThan(1e-6);
    expect(world.env.mu).toBeCloseTo(bodyDef('moon').gm, 0);
  });

  it('full physics also notices a sphere of influence', () => {
    const { eph, world } = makeWorld();
    const m = eph.relative('moon', UT);
    const u = m.pos.map((x) => x / length(m.pos)) as Vec3;
    world.spawn(craft(), [m.pos[0] - 3e7 * u[0], m.pos[1] - 3e7 * u[1], m.pos[2] - 3e7 * u[2]], [0, 0, 0], [0, 1, 0]);
    for (let i = 0; i < 40; i++) world.step(1 / 120);
    expect(world.bodyId).toBe('moon');
  });
});

describe('time warp ladder', () => {
  it('keeps to physics warp when rails is blocked, and says why', () => {
    const w = new Warp();
    expect(w.change(1, null)).toBeNull();
    expect(w.rate).toBe(2);
    for (let i = 0; i < 5; i++) w.change(1, 'Engines are running');
    expect(w.index).toBe(MAX_PHYSICS_INDEX);
    expect(w.change(1, 'Engines are running')).toMatch(/cannot time warp/i);
    expect(w.rails).toBe(false);
    for (let i = 0; i < 12; i++) w.change(1, null);
    expect(w.rate).toBe(100_000);
    w.update(0, 'Too low');
    expect(w.rails).toBe(false);
  });

  it('warps to a time, slows down on approach and stops there', () => {
    const w = new Warp();
    w.warpTo(10_000);
    let ut = 0;
    const rates: number[] = [];
    for (let frame = 0; frame < 5000 && w.target !== null; frame++) {
      const room = w.update(ut, null);
      const step = Math.min((1 / 60) * w.rate, room);
      ut += step;
      if (frame % 50 === 0) rates.push(w.rate);
    }
    expect(w.target).toBeNull();
    expect(ut).toBeCloseTo(10_000, 0);
    expect(Math.max(...rates)).toBeGreaterThanOrEqual(1_000);
    expect(w.rate).toBe(1);
  });
});

describe('re-entry heating', () => {
  const capsule = (shield: boolean) => {
    const { craft: c, root } = startCraft('capsule', 'pod-capsule');
    if (shield) below(c, root, 'shield-125');
    return buildVessel(finish(c));
  };

  /** Fly a crude entry profile (bottom first): 7.6 km/s at 85 km down to 600 m/s at 25 km over 240 s. */
  function enter(shield: boolean) {
    const v = capsule(shield);
    const destroyed: string[] = [];
    let peak = 0;
    for (let t = 0; t < 240; t += 0.1) {
      const f = t / 240;
      const speed = 7600 - 7000 * f ** 1.4;
      const h = 85_000 - 60_000 * f;
      const air = earthAir(h);
      const res = heatVessel(v, [0, -1, 0], air.density, speed, air.temperature, 0.1);
      peak = Math.max(peak, v.tele.heatFlux);
      for (const id of res.overheated) {
        destroyed.push(id);
        v.parts = v.parts.filter((p) => p.id !== id);
      }
    }
    return { v, destroyed, peak };
  }

  it('a bare capsule burns up and a shielded one survives, ablating as it goes', () => {
    const bare = enter(false);
    expect(bare.destroyed.length).toBeGreaterThan(0);
    const shielded = enter(true);
    expect(shielded.destroyed).toEqual([]);
    const shieldPart = shielded.v.parts.find((p) => p.def.category === 'heatshield')!;
    expect(shieldPart.ablator).toBeLessThan(shieldPart.def.dryMass * 0.55);
    expect(shieldPart.ablator).toBeGreaterThan(0);
    expect(shielded.peak).toBeGreaterThan(2e5); // a real, hot entry
    expect(Math.max(...shielded.v.parts.map((p) => p.temperature))).toBeLessThan(3300);
  });

  it('a slow, high pass heats nothing', () => {
    const v = capsule(false);
    for (let t = 0; t < 60; t += 0.1) heatVessel(v, [0, -1, 0], earthAir(80_000).density, 300, 220, 0.1);
    expect(v.tele.heat).toBeLessThan(0.3);
  });
});

describe('deep atmospheres', () => {
  it('crushes a vessel that sinks too deep into a gas giant, while Venus surface pressure is survivable', () => {
    const jupiter = makeWorld('jupiter');
    const r = bodyDef('jupiter').radius;
    jupiter.world.spawn(craft(), [r - 135_000, 0, 0], [0, 0, 0], [0, 1, 0]);
    jupiter.world.step(1 / 120);
    expect(jupiter.world.active).toBeNull();

    const venus = makeWorld('venus');
    const v = venus.world.spawn(craft(), [bodyDef('venus').radius + 30, 0, 0], [0, 0, 0], [0, 1, 0]);
    venus.world.step(1 / 120);
    expect(venus.world.active).toBe(v);
    expect(v.parts.length).toBeGreaterThan(0);
  });
});

describe('entering other atmospheres', () => {
  const capsule = () => {
    const { craft: c, root } = startCraft('capsule', 'pod-capsule');
    below(c, root, 'shield-125');
    return finish(c);
  };

  it('Mars heats a shielded capsule only mildly and its thin air barely slows it: the ground arrives at hypersonic speed', () => {
    const { world } = makeWorld('mars');
    const mars = bodyDef('mars');
    const r = mars.radius + 120_000;
    const gamma = (12 * Math.PI) / 180;
    const speed = 5600;
    const v = world.spawn(capsule(), [r, 0, 0], [-speed * Math.sin(gamma), 0, speed * Math.cos(gamma)], [0, -1, 0]);
    v.sas.enabled = true;
    v.sas.mode = 'retrograde';
    let peakHeat = 0;
    let lastSpeed = speed;
    const logs: string[] = [];
    for (let t = 0; t < 900 && world.active === v; t += 1 / 120) {
      world.step(1 / 120);
      peakHeat = Math.max(peakHeat, v.tele.heat);
      lastSpeed = Math.hypot(...v.vel);
      logs.push(...v.log.splice(0));
    }
    expect(logs.some((l) => /burned up/.test(l))).toBe(false); // the shield did its job
    expect(peakHeat).toBeGreaterThan(0.1);
    expect(peakHeat).toBeLessThan(1);
    expect(lastSpeed).toBeGreaterThan(2000); // no parachute saves you from 5.6 km/s at Mars
    expect(lastSpeed).toBeLessThan(speed);
    expect(world.active).toBeNull(); // it hit the ground
  });
});

describe('rails near the air', () => {
  it('stops exactly where the orbit reaches the air even when the hop ends there', () => {
    const { world, nav } = makeWorld();
    const rp = earth.radius + 35_000;
    const a = (rp + 4e8) / 2;
    const vp = Math.sqrt(MU * (2 / rp - 1 / a));
    const start = propagate({ r: [rp, 0, 0], v: [0, 0, vp] }, MU, -200_000);
    world.spawn(craft(), start.r, start.v, [0, 0, 1]);
    nav.refresh(0, 0, true);
    let stopped: string | null = null;
    for (let i = 0; i < 100 && !stopped; i++) stopped = nav.advanceRails(3600, 0).stopped;
    expect(stopped).toBe('floor');
    expect(length(world.active!.pos) - earth.radius).toBeCloseTo(world.env.railsFloor!, -1);
  });
});

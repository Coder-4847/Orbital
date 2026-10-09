import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/builder/examples';
import { bodyDef } from '../src/data/solar-system';
import { altitudeOf } from '../src/flight/env';
import { jumpToTime, surfaceDirection, teleportToOrbit, teleportToSurface } from '../src/flight/relocate';
import { orbitInfo } from '../src/flight/orbit-info';
import { length, propagate, sub, type Vec3 } from '../src/physics/kepler';
import { DT, makeRig, startInOrbit } from './helpers/mission';

const sparrow = () => EXAMPLES[0]!.build();
const totalFuel = (rig: ReturnType<typeof makeRig>) => rig.world.active!.parts.reduce((s, p) => s + p.fuel, 0);

function onTheGround() {
  const rig = makeRig();
  const v = rig.world.launch(sparrow(), { direction: [Math.cos(0.5), Math.sin(0.5), 0], headingDeg: 90 });
  return { rig, v };
}

const steps = (rig: ReturnType<typeof makeRig>, seconds: number) => {
  for (let i = 0; i < seconds / DT; i++) rig.world.step(DT);
};

describe('cheats in the flight physics', () => {
  it('unlimited fuel keeps the tanks full while the engines burn', () => {
    const { rig, v } = onTheGround();
    rig.world.cheats.unlimitedFuel = true;
    const before = totalFuel(rig);
    v.throttle = 1;
    rig.world.stage();
    steps(rig, 10);
    expect(v.tele.thrust).toBeGreaterThan(0);
    expect(totalFuel(rig)).toBeCloseTo(before, 3);
  });

  it('a thrust multiplier lifts a rocket that is too weak to leave the pad', () => {
    const { rig, v } = onTheGround();
    rig.world.cheats.thrustMultiplier = 0.4; // too weak to lift the rocket
    v.throttle = 1;
    rig.world.stage();
    steps(rig, 5);
    expect(v.situation).toBe('rest');
    rig.world.cheats.thrustMultiplier = 1.5;
    steps(rig, 5);
    expect(v.situation).toBe('flying');
  });

  it('invulnerable survives an impact that wrecks a normal rocket', () => {
    const run = (invulnerable: boolean) => {
      const rig = makeRig();
      rig.world.cheats.invulnerable = invulnerable;
      const earth = bodyDef('earth');
      const v = rig.world.spawn(sparrow(), [earth.radius + 3, 0, 0], [-30, 0, 0], [1, 0, 0]);
      const n = v.parts.length;
      steps(rig, 3);
      return { before: n, after: rig.world.active?.parts.length ?? 0, split: rig.world.vessels.length > 1 };
    };
    const hard = run(false);
    expect(hard.after < hard.before || hard.split).toBe(true);
    const easy = run(true);
    expect(easy.after).toBe(easy.before);
    expect(easy.split).toBe(false);
  });

  it('no aerodynamic forces means no drag; zero gravity means a straight line', () => {
    const earth = bodyDef('earth');
    const flyBy = (aero: boolean, gravity: boolean) => {
      const rig = makeRig();
      rig.world.cheats.noAero = !aero;
      rig.world.cheats.zeroGravity = !gravity;
      const v = rig.world.spawn(sparrow(), [earth.radius + 8_000, 0, 0], [0, 0, 600], [0, 0, 1]);
      const speed0 = length(v.vel);
      steps(rig, 4);
      return { slowdown: speed0 - length(v.vel), v };
    };
    expect(flyBy(true, true).slowdown).toBeGreaterThan(flyBy(false, true).slowdown + 5);
    const zero = flyBy(false, false);
    expect(Math.abs(zero.slowdown)).toBeLessThan(0.01);
    expect(zero.v.vel[0]).toBeCloseTo(0, 6); // no pull towards the planet
  });

  it('refuel and repair restores propellant, charge and temperatures', () => {
    const { rig } = onTheGround();
    const v = rig.world.active!;
    for (const p of v.parts) {
      p.fuel = 0;
      p.temperature = 900;
    }
    v.charge = 0;
    rig.world.refuelAndRepair();
    expect(totalFuel(rig)).toBeGreaterThan(40_000);
    expect(v.charge).toBe(v.chargeMax);
    expect(Math.max(...v.parts.map((p) => p.temperature))).toBe(288);
  });

  it('with heating switched off an entry shows no heat at all', () => {
    const earth = bodyDef('earth');
    const run = (noHeating: boolean) => {
      const rig = makeRig();
      rig.world.cheats.noHeating = noHeating;
      const v = rig.world.spawn(sparrow(), [earth.radius + 75_000, 0, 0], [-450, 0, 7600], [0, 0, -1]);
      let worst = 0;
      for (let i = 0; i < 20 / DT && rig.world.active; i++) {
        rig.world.step(DT);
        worst = Math.max(worst, v.tele.heat);
      }
      return worst;
    };
    expect(run(false)).toBeGreaterThan(0.05);
    expect(run(true)).toBe(0);
  });
});

describe('moving the vessel', () => {
  it('puts the vessel in a circular orbit about any body, at the altitude asked for', () => {
    const rig = makeRig();
    startInOrbit(rig, sparrow());
    expect(teleportToOrbit(rig.world, 'moon', 120_000)).toBeNull();
    const o = orbitInfo(rig.world.active!.pos, rig.world.active!.vel, rig.world.env.mu, rig.world.env.radius);
    expect(rig.world.bodyId).toBe('moon');
    expect(o.periapsis).toBeCloseTo(120_000, -2);
    expect(o.apoapsis).toBeCloseTo(120_000, -2);
    expect(teleportToOrbit(rig.world, 'jupiter', 500_000)).toBeNull();
    expect(rig.world.bodyId).toBe('jupiter');
    expect(rig.world.active!.situation).toBe('flying');
  });

  it('stands the vessel on the ground at a chosen latitude and longitude, and refuses bodies without a surface', () => {
    const rig = makeRig();
    startInOrbit(rig, sparrow());
    expect(teleportToSurface(rig.world, 'moon', 20, 30)).toBeNull();
    const v = rig.world.active!;
    expect(v.situation).toBe('rest');
    expect(altitudeOf(rig.world.env, v.pos)).toBeLessThan(30);
    const unit = v.restPos.map((x) => x / length(v.restPos)) as Vec3;
    expect(length(sub(unit, surfaceDirection(20, 30)))).toBeLessThan(1e-9);
    expect(teleportToSurface(rig.world, 'jupiter', 0, 0)).toMatch(/no surface/);
    expect(teleportToSurface(rig.world, 'sun', 0, 0)).toMatch(/no surface/);
  });

  it('jumps universal time: a landed vessel waits, a vessel in orbit follows its orbit', () => {
    const { rig, v } = onTheGround();
    const t0 = rig.world.ut;
    expect(jumpToTime(rig.world, rig.nav, t0 + 86400)).toBeNull();
    expect(rig.world.ut).toBeCloseTo(t0 + 86400, 3);
    expect(v.situation).toBe('rest');

    const orbit = makeRig();
    const earth = bodyDef('earth');
    const o = startInOrbit(orbit, sparrow(), 400_000);
    const start = { r: [...o.pos] as Vec3, v: [...o.vel] as Vec3 };
    expect(jumpToTime(orbit.world, orbit.nav, orbit.world.ut + 5 * 3600)).toBeNull();
    expect(length(sub(o.pos, propagate(start, earth.gm, 5 * 3600).r))).toBeLessThan(1);
    expect(jumpToTime(orbit.world, orbit.nav, orbit.world.ut - 3600)).toBeNull();
    expect(length(sub(o.pos, propagate(start, earth.gm, 4 * 3600).r))).toBeLessThan(1);
  });

  it('refuses to skip time inside the air', () => {
    const { rig } = onTheGround();
    const v = rig.world.active!;
    v.situation = 'flying';
    v.pos = [bodyDef('earth').radius + 20_000, 0, 0];
    expect(jumpToTime(rig.world, rig.nav, rig.world.ut + 1000)).toMatch(/too low/i);
  });
});

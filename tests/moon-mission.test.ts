import { describe, expect, it } from 'vitest';
import { bodyDef } from '../src/data/solar-system';
import { orbitInfo } from '../src/flight/orbit-info';
import { apsisTimes } from '../src/flight/trajectory';
import { ascendToOrbit, coastTo, correctCourse, executeNode, lowerPeriapsis, makeRig, moduleCraft, patchesFor, planReturn, powerDescent, reenterAndLand, startInOrbit, tuneNode } from './helpers/mission';
import { findTransferBurn } from './helpers/transfer';

describe('the Moon mission, flown with the tools a player has', () => {
  it('leaves low Earth orbit, crosses into the Moon sphere of influence, lands, takes off and returns to a parachute landing', () => {
    const rig = makeRig();
    const { world, nav } = rig;
    const v0 = startInOrbit(rig, moduleCraft());
    const earth = bodyDef('earth');
    const orbit = () => orbitInfo(world.active!.pos, world.active!.vel, world.env.mu, world.env.radius);
    const fail = (msg: string): never => {
      throw new Error(`${msg}\n${rig.log.filter((l) => !/^   (burn|descent|touch|ascent|entry|hop|coast)/.test(l)).join('\n')}`);
    };

    // --- trans-lunar injection: plan on the map, burn, correct
    const plan = findTransferBurn({ model: rig.model, body: 'earth', r: v0.pos, v: v0.vel, ut: world.ut, mu: earth.gm, target: 'moon', dv: 3130, coast: 4.5 * 86400 });
    if (!plan) fail('No transfer window to the Moon found.');
    const tli = tuneNode(rig, { ut: plan!.burnUt, prograde: 3130, normal: 0, radial: 0 }, 'moon', 100_000, { time: true });
    if (!tli) fail('The trans-lunar burn could not be planned.');
    executeNode(rig, tli!);
    correctCourse(rig, 'moon', 100_000, 500_000, 6 * 3600);
    const encounter = patchesFor(rig, world.active!.pos, world.active!.vel, world.ut, 'earth', [], 4).find((p) => p.body === 'moon');
    expect(encounter, 'a predicted Moon encounter').toBeDefined();

    // --- coast on rails into the Moon's sphere of influence
    expect(coastTo(rig, world.ut + 10 * 86400)).toBe('soi');
    expect(world.bodyId).toBe('moon');
    expect(world.events.some((e) => e.kind === 'soi')).toBe(true);

    // --- lunar orbit insertion at periapsis
    const mp = patchesFor(rig, world.active!.pos, world.active!.vel, world.ut, 'moon', [], 1)[0]!;
    const rpe = mp.elements.a * (1 - mp.elements.e);
    const vpe = Math.sqrt(mp.mu * (2 / rpe - 1 / mp.elements.a));
    executeNode(rig, nav.addNode(apsisTimes(mp.elements, mp.mu, mp.startUt, world.ut).pe, { prograde: -(vpe - Math.sqrt(mp.mu / rpe)) }));
    expect(orbit().bound).toBe(true);
    expect(orbit().periapsis).toBeGreaterThan(30_000);
    expect(orbit().apoapsis).toBeLessThan(600_000);

    // --- deorbit and land with the descent stage
    world.stage(); // the transfer stage drops away, the descent engine lights
    lowerPeriapsis(rig, 8_000);
    coastTo(rig, world.ut + 20_000);
    powerDescent(rig);
    const landed = world.active!;
    expect(landed.situation).toBe('rest');
    expect(landed.parts.some((p) => p.def.category === 'command')).toBe(true);
    expect(landed.parts.filter((p) => p.def.look === 'leg')).toHaveLength(4);
    expect(landed.parts.length).toBeGreaterThanOrEqual(12); // nothing broke on touchdown

    // --- take off and reach lunar orbit with the ascent stage
    ascendToOrbit(rig, 100_000);
    expect(orbit().periapsis).toBeGreaterThan(80_000);

    // --- trans-Earth injection, coast home, re-enter on the heat shield, land under the parachutes
    executeNode(rig, planReturn(rig));
    const result = reenterAndLand(rig);
    expect(world.bodyId).toBe('earth');
    expect(result.peakHeat).toBeGreaterThan(0.4); // a real, hot entry from 11 km/s
    expect(result.peakHeat).toBeLessThan(1);
    expect(result.touchdownSpeed).toBeLessThan(14);
    const capsule = world.active!;
    expect(capsule.situation).toBe('rest');
    expect(capsule.parts.some((p) => p.def.category === 'command')).toBe(true);
  }, 1_800_000);
});

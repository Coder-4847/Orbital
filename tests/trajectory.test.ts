import { describe, expect, it } from 'vitest';
import { bodyDef } from '../src/data/solar-system';
import { Ephemeris } from '../src/physics/ephemeris';
import { length, propagate, sub, type Vec3 } from '../src/physics/kepler';
import { burnFrame, nodeDeltaV, type ManeuverNode } from '../src/flight/maneuver';
import { apsisTimes, closestApproach, patchState, predictTrajectory, type NavModel } from '../src/flight/trajectory';

const eph = new Ephemeris();
const model: NavModel = { ephemeris: eph, floor: (id) => (id === 'earth' ? 100_000 : 15_000) };
const earth = bodyDef('earth');
const MU = earth.gm;
const T0 = 8.0e8; // an arbitrary date (2025)

const circular = (radius: number): { r: Vec3; v: Vec3 } => ({ r: [radius, 0, 0], v: [0, 0, Math.sqrt(MU / radius)] });
const norm = (a: Vec3): Vec3 => [a[0] / length(a), a[1] / length(a), a[2] / length(a)];

describe('conic prediction', () => {
  it('follows a circular low orbit for the whole horizon without events', () => {
    const { r, v } = circular(earth.radius + 300_000);
    const traj = predictTrajectory(model, { body: 'earth', r, v, ut: T0 }, []);
    expect(traj.patches).toHaveLength(1);
    const p = traj.patches[0]!;
    expect(p.end).toBe('horizon');
    expect(p.bound).toBe(true);
    expect(p.period).toBeCloseTo(2 * Math.PI * Math.sqrt((earth.radius + 3e5) ** 3 / MU), 3);
    expect(p.floorUt).toBeNull();
  });

  it('finds the impact of a suborbital path, after crossing the rails floor', () => {
    const r: Vec3 = [earth.radius + 400_000, 0, 0];
    const v: Vec3 = [0, 0, 0.55 * Math.sqrt(MU / length(r))];
    const p = predictTrajectory(model, { body: 'earth', r, v, ut: T0 }, []).patches[0]!;
    expect(p.end).toBe('impact');
    expect(length(p.r1)).toBeCloseTo(earth.radius, 0);
    expect(p.floorUt).not.toBeNull();
    expect(p.floorUt!).toBeLessThan(p.endUt);
    expect(length(patchState(p, p.floorUt!).r)).toBeCloseTo(earth.radius + 100_000, -1);
  });

  it('reports an impact at once when the vessel starts on the ground', () => {
    const p = predictTrajectory(model, { body: 'earth', r: [earth.radius, 0, 0], v: [0, 0, 0], ut: T0 }, []).patches[0]!;
    expect(p.end).toBe('impact');
    expect(p.endUt).toBeCloseTo(T0, 3);
  });

  it('leaves a body on an escape trajectory at exactly the sphere-of-influence radius', () => {
    const r: Vec3 = [earth.radius + 300_000, 0, 0];
    const v: Vec3 = [0, 0, 1.05 * Math.sqrt((2 * MU) / length(r))];
    const traj = predictTrajectory(model, { body: 'earth', r, v, ut: T0 }, [], { maxPatches: 2 });
    const p = traj.patches[0]!;
    expect(p.end).toBe('soi-exit');
    expect(p.next).toBe('sun');
    expect(length(p.r1)).toBeCloseTo(eph.soi.get('earth')!, -1);
    // the next patch is about the Sun, and the vessel is where Earth is (heliocentric state continuity)
    const sun = traj.patches[1]!;
    expect(sun.body).toBe('sun');
    const earthState = eph.stateAt('earth', p.endUt);
    expect(length(sub(sun.r0, [earthState.pos[0] + p.r1[0], earthState.pos[1] + p.r1[1], earthState.pos[2] + p.r1[2]]))).toBeLessThan(1);
    expect(length(sub(sun.v0, [earthState.vel[0] + p.v1[0], earthState.vel[1] + p.v1[1], earthState.vel[2] + p.v1[2]]))).toBeLessThan(1e-3);
  });

  it('applies a maneuver node: a prograde burn from a circular orbit gives the vis-viva apoapsis', () => {
    const r0 = earth.radius + 200_000;
    const { r, v } = circular(r0);
    const node: ManeuverNode = { id: 1, ut: T0 + 600, prograde: 3140, normal: 0, radial: 0 };
    const traj = predictTrajectory(model, { body: 'earth', r, v, ut: T0 }, [node]);
    expect(traj.patches[0]!.end).toBe('node');
    expect(traj.patches[0]!.nodeId).toBe(1);
    const after = traj.patches[1]!;
    expect(after.startUt).toBeCloseTo(T0 + 600, 3);
    const v1 = Math.sqrt(MU / r0) + 3140;
    const a = 1 / (2 / r0 - (v1 * v1) / MU);
    const apoapsis = 2 * a - r0;
    expect(after.elements.a * (1 + after.elements.e)).toBeCloseTo(apoapsis, -2);
  });

  it('a normal burn tilts the orbit plane and leaves the energy unchanged', () => {
    const { r, v } = circular(earth.radius + 300_000);
    const node: ManeuverNode = { id: 2, ut: T0 + 1000, prograde: 0, normal: 500, radial: 0 };
    const traj = predictTrajectory(model, { body: 'earth', r, v, ut: T0 }, [node]);
    const before = traj.patches[0]!;
    const after = traj.patches[1]!;
    const dv = nodeDeltaV(node, before.r1, before.v1);
    expect(length(dv)).toBeCloseTo(500, 6);
    expect(after.elements.i).toBeGreaterThan(0.05);
    const v0 = length(before.v1);
    const energyBefore = (v0 * v0) / 2 - MU / length(before.r1);
    const energyAfter = (length(after.v0) ** 2) / 2 - MU / length(after.r0);
    expect(energyAfter - energyBefore).toBeCloseTo(500 * 500 / 2, 0); // a normal burn adds only dv^2/2 of energy
  });

  it('burn frame axes are orthonormal and radial points away from the body in a circular orbit', () => {
    const { r, v } = circular(7e6);
    const f = burnFrame(r, v);
    expect(f.radial[0]).toBeCloseTo(1, 9);
    expect(f.prograde[2]).toBeCloseTo(1, 9);
    expect(Math.abs(f.normal[1])).toBeCloseTo(1, 9);
  });

  it('apsis times match the orbit', () => {
    const r: Vec3 = [earth.radius + 300_000, 0, 0];
    const v: Vec3 = [0, 0, 1.2 * Math.sqrt(MU / r[0])];
    const p = predictTrajectory(model, { body: 'earth', r, v, ut: T0 }, [], { maxOrbits: 1 }).patches[0]!;
    const a = apsisTimes(p.elements, MU, T0, T0);
    expect(length(propagate({ r, v }, MU, a.pe - T0).r)).toBeCloseTo(p.elements.a * (1 - p.elements.e), -1);
    expect(length(propagate({ r, v }, MU, a.ap - T0).r)).toBeCloseTo(p.elements.a * (1 + p.elements.e), -1);
  });
});

describe('encounters', () => {
  /** A bound Earth orbit whose path crosses the Moon's sphere of influence, built by running a state backwards from inside it. */
  function aimedAtMoon() {
    const tEnc = T0 + 3 * 86400;
    const m = eph.relative('moon', tEnc);
    const u = norm(m.pos);
    // a point on the Earth side of the Moon, inside its sphere of influence, climbing away from Earth
    const inside: Vec3 = [m.pos[0] - 4.5e7 * u[0], m.pos[1] - 4.5e7 * u[1], m.pos[2] - 4.5e7 * u[2]];
    const dir = norm(m.vel);
    const vel: Vec3 = [u[0] * 1000 + dir[0] * 400, u[1] * 1000 + dir[1] * 400, u[2] * 1000 + dir[2] * 400];
    const start = propagate({ r: inside, v: vel }, MU, -2 * 86400);
    return { tEnc, start, inside, vel };
  }

  it('detects entering the Moon sphere of influence and hands over to a Moon-centred patch', () => {
    const { tEnc, start } = aimedAtMoon();
    const traj = predictTrajectory(model, { body: 'earth', r: start.r, v: start.v, ut: tEnc - 2 * 86400 }, [], { maxPatches: 3 });
    const first = traj.patches[0]!;
    expect(first.end).toBe('soi-enter');
    expect(first.next).toBe('moon');
    expect(first.endUt).toBeLessThanOrEqual(tEnc);
    const soi = eph.soi.get('moon')!;
    const rel = eph.relative('moon', first.endUt);
    expect(length(sub(first.r1, rel.pos))).toBeCloseTo(soi, -2);
    const second = traj.patches[1]!;
    expect(second.body).toBe('moon');
    expect(length(second.r0)).toBeCloseTo(soi, -2);
    // continuity: Moon-relative velocity plus the Moon's own velocity gives the Earth-relative one
    const vSum: Vec3 = [second.v0[0] + rel.vel[0], second.v0[1] + rel.vel[1], second.v0[2] + rel.vel[2]];
    expect(length(sub(vSum, first.v1))).toBeLessThan(1e-3);
  });

  it('after an encounter the Moon patch ends by leaving the sphere of influence or hitting the surface', () => {
    const { tEnc, start } = aimedAtMoon();
    const traj = predictTrajectory(model, { body: 'earth', r: start.r, v: start.v, ut: tEnc - 2 * 86400 }, [], { maxPatches: 3 });
    const moonPatch = traj.patches[1]!;
    expect(['soi-exit', 'impact']).toContain(moonPatch.end);
    if (moonPatch.end === 'soi-exit') {
      expect(moonPatch.next).toBe('earth');
      expect(length(moonPatch.r1)).toBeCloseTo(eph.soi.get('moon')!, -2);
      expect(traj.patches[2]!.body).toBe('earth');
    }
  });

  it('finds the closest approach to the Moon on a path that misses', () => {
    const { tEnc, start } = aimedAtMoon();
    // shift the path sideways so it misses the sphere of influence
    const r: Vec3 = [start.r[0], start.r[1] + 2e8, start.r[2]];
    const p = predictTrajectory(model, { body: 'earth', r, v: start.v, ut: tEnc - 2 * 86400 }, [], { maxOrbits: 1 }).patches[0]!;
    const ap = closestApproach(model, p, 'moon')!;
    expect(ap).not.toBeNull();
    let brute = Infinity;
    for (let i = 0; i <= 4000; i++) {
      const t = p.startUt + ((p.endUt - p.startUt) * i) / 4000;
      brute = Math.min(brute, length(sub(patchState(p, t).r, eph.relative('moon', t).pos)));
    }
    expect(ap.distance).toBeLessThanOrEqual(brute + 1);
    expect(ap.distance).toBeGreaterThan(brute * 0.995 - 1);
    expect(closestApproach(model, p, 'mars')).toBeNull();
  });

  it('a trans-lunar burn node from low orbit turns a closed orbit into one that reaches the Moon', () => {
    // Hohmann-like burn from LEO with the Moon placed so the apogee meets it: search the burn time over one Moon-phase window.
    const r0 = earth.radius + 190_000;
    const circ = circular(r0);
    const tli = 3130;
    let found = false;
    for (let k = 0; k < 1100 && !found; k++) {
      const burnUt = T0 + k * 2500;
      const orbit = propagate(circ, MU, burnUt - T0);
      const node: ManeuverNode = { id: 1, ut: burnUt, prograde: tli, normal: 0, radial: 0 };
      const traj = predictTrajectory(model, { body: 'earth', r: orbit.r, v: orbit.v, ut: burnUt - 1 }, [node], { maxPatches: 3, maxOrbits: 2 });
      const moonPatch = traj.patches.find((p) => p.body === 'moon');
      if (moonPatch && moonPatch.startUt - burnUt < 7 * 86400) {
        found = true;
        expect(moonPatch.startUt - burnUt).toBeGreaterThan(2.5 * 86400);
      }
    }
    expect(found).toBe(true);
  });

  it('a handover out of a sphere of influence never leaves an empty patch behind', () => {
    const { tEnc, start } = aimedAtMoon();
    const traj = predictTrajectory(model, { body: 'earth', r: start.r, v: start.v, ut: tEnc - 2 * 86400 }, [], { maxPatches: 6 });
    for (const p of traj.patches) if (p.end !== 'impact') expect(p.endUt - p.startUt).toBeGreaterThan(60);
  });

  it('follows a closed orbit all the way to a maneuver node that is many orbits away', () => {
    const { r, v } = circular(earth.radius + 300_000);
    const node: ManeuverNode = { id: 5, ut: T0 + 3 * 86400, prograde: 100, normal: 0, radial: 0 };
    const traj = predictTrajectory(model, { body: 'earth', r, v, ut: T0 }, [node]);
    expect(traj.patches[0]!.end).toBe('node');
    expect(traj.patches[0]!.endUt).toBeCloseTo(T0 + 3 * 86400, 2);
    expect(traj.patches[1]!.startUt).toBeCloseTo(T0 + 3 * 86400, 2);
  });
});

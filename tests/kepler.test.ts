import { describe, expect, it } from 'vitest';
import {
  dot,
  elementsToState,
  length,
  meanMotion,
  orbitPoints,
  orbitalPeriod,
  propagate,
  soiRadius,
  solveKepler,
  solveKeplerHyperbolic,
  stateToElements,
  wrapPi,
  type Elements,
  type Vec3,
} from '../src/physics/kepler';

const MU_EARTH = 3.986004418e14;
const MU_SUN = 1.32712440018e20;
const MU_MOON = 4.9048695e12;
const DEG = Math.PI / 180;

const energy = (r: Vec3, v: Vec3, mu: number) => dot(v, v) / 2 - mu / length(r);
const angMom = (r: Vec3, v: Vec3) => length([r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]]);

describe('Kepler solver', () => {
  it('satisfies Kepler\'s equation to machine precision across e and M', () => {
    for (const e of [0, 0.01, 0.1, 0.5, 0.8, 0.95, 0.99, 0.9999]) {
      for (let k = -40; k <= 40; k++) {
        const M = (k / 40) * Math.PI * 3.3;
        const E = solveKepler(M, e);
        expect(Math.abs(E - e * Math.sin(E) - wrapPi(M))).toBeLessThan(1e-11);
      }
    }
  });

  it('solves the hyperbolic equation including large anomalies', () => {
    for (const e of [1.0001, 1.2, 2, 5, 20]) {
      for (const M of [-500, -20, -1, -0.01, 0, 0.3, 4, 90, 3000]) {
        const H = solveKeplerHyperbolic(M, e);
        expect(Math.abs(e * Math.sinh(H) - H - M)).toBeLessThan(1e-8 * Math.max(1, Math.abs(M)));
      }
    }
  });
});

describe('elements <-> state', () => {
  const elliptic: Elements = { a: 7_000_000, e: 0.12, i: 51.6 * DEG, omegaNode: 40 * DEG, omegaPeri: 75 * DEG, M0: 1.1, epoch: 0 };

  it('round-trips elliptical orbits at several times', () => {
    for (const t of [0, 600, 5000, 123456]) {
      const s = elementsToState(elliptic, MU_EARTH, t);
      const back = stateToElements(s, MU_EARTH, t);
      expect(back.a).toBeCloseTo(elliptic.a, 3);
      expect(back.e).toBeCloseTo(elliptic.e, 9);
      expect(back.i).toBeCloseTo(elliptic.i, 9);
      expect(wrapPi(back.omegaNode - elliptic.omegaNode)).toBeCloseTo(0, 9);
      expect(wrapPi(back.omegaPeri - elliptic.omegaPeri)).toBeCloseTo(0, 8);
      // The mean anomaly at t must match the original orbit's mean anomaly at t.
      const expected = elliptic.M0 + meanMotion(elliptic.a, MU_EARTH) * t;
      expect(Math.abs(wrapPi(back.M0 - expected))).toBeLessThan(1e-8);
    }
  });

  it('round-trips hyperbolic orbits', () => {
    const hyper: Elements = { a: -2e7, e: 1.6, i: 20 * DEG, omegaNode: 10 * DEG, omegaPeri: 200 * DEG, M0: -0.8, epoch: 0 };
    const s = elementsToState(hyper, MU_EARTH, 400);
    const back = stateToElements(s, MU_EARTH, 400);
    expect(back.a / hyper.a).toBeCloseTo(1, 9);
    expect(back.e).toBeCloseTo(hyper.e, 9);
    expect(back.i).toBeCloseTo(hyper.i, 9);
    const again = elementsToState(back, MU_EARTH, 400);
    expect(length([again.r[0] - s.r[0], again.r[1] - s.r[1], again.r[2] - s.r[2]]) / length(s.r)).toBeLessThan(1e-9);
  });

  it('handles circular and equatorial degeneracies without NaN', () => {
    const circEq: Elements = { a: 6_800_000, e: 0, i: 0, omegaNode: 0, omegaPeri: 0, M0: 2, epoch: 0 };
    const s = elementsToState(circEq, MU_EARTH, 100);
    const back = stateToElements(s, MU_EARTH, 100);
    expect(Number.isFinite(back.a + back.e + back.i + back.omegaPeri + back.M0)).toBe(true);
    const again = elementsToState(back, MU_EARTH, 100);
    expect(length([again.r[0] - s.r[0], again.r[1] - s.r[1], again.r[2] - s.r[2]])).toBeLessThan(1);
  });

  it('periapsis and apoapsis radii are a(1-e) and a(1+e)', () => {
    const peri = elementsToState({ ...elliptic, M0: 0 }, MU_EARTH, 0);
    const apo = elementsToState({ ...elliptic, M0: Math.PI }, MU_EARTH, 0);
    expect(length(peri.r)).toBeCloseTo(elliptic.a * (1 - elliptic.e), 3);
    expect(length(apo.r)).toBeCloseTo(elliptic.a * (1 + elliptic.e), 3);
  });
});

describe('propagation', () => {
  const el: Elements = { a: 1.5e11, e: 0.2, i: 0.1, omegaNode: 0.4, omegaPeri: 1.2, M0: 0.5, epoch: 0 };

  it('universal-variable propagation agrees with analytic elements at arbitrary times', () => {
    const start = elementsToState(el, MU_SUN, 0);
    for (const dt of [1000, 86400 * 30, 86400 * 200, 86400 * 400, -86400 * 90]) {
      const viaElements = elementsToState(el, MU_SUN, dt);
      const viaPropagate = propagate(start, MU_SUN, dt);
      expect(length([viaElements.r[0] - viaPropagate.r[0], viaElements.r[1] - viaPropagate.r[1], viaElements.r[2] - viaPropagate.r[2]]) / el.a).toBeLessThan(1e-8);
      expect(length([viaElements.v[0] - viaPropagate.v[0], viaElements.v[1] - viaPropagate.v[1], viaElements.v[2] - viaPropagate.v[2]]) / length(viaElements.v)).toBeLessThan(1e-8);
    }
  });

  it('conserves energy and angular momentum over many orbits of a low Earth orbit', () => {
    const leo: Elements = { a: 6_778_000, e: 0.001, i: 0.9, omegaNode: 0, omegaPeri: 0, M0: 0, epoch: 0 };
    let s = elementsToState(leo, MU_EARTH, 0);
    const e0 = energy(s.r, s.v, MU_EARTH);
    const h0 = angMom(s.r, s.v);
    for (let k = 0; k < 500; k++) s = propagate(s, MU_EARTH, 3333.3);
    expect(Math.abs(energy(s.r, s.v, MU_EARTH) / e0 - 1)).toBeLessThan(1e-9);
    expect(Math.abs(angMom(s.r, s.v) / h0 - 1)).toBeLessThan(1e-9);
  });

  it('one full period returns to the start', () => {
    const start = elementsToState(el, MU_SUN, 0);
    const T = orbitalPeriod(el.a, MU_SUN);
    const end = propagate(start, MU_SUN, T);
    expect(length([end.r[0] - start.r[0], end.r[1] - start.r[1], end.r[2] - start.r[2]]) / el.a).toBeLessThan(1e-8);
  });

  it('propagates a hyperbolic flyby through periapsis', () => {
    const hyper: Elements = { a: -3e7, e: 2, i: 0.3, omegaNode: 0, omegaPeri: 0, M0: -3, epoch: 0 };
    const s0 = elementsToState(hyper, MU_EARTH, 0);
    const s1 = propagate(s0, MU_EARTH, 5000);
    const expected = elementsToState(hyper, MU_EARTH, 5000);
    expect(length([s1.r[0] - expected.r[0], s1.r[1] - expected.r[1], s1.r[2] - expected.r[2]]) / length(expected.r)).toBeLessThan(1e-7);
  });
});

describe('periods and spheres of influence', () => {
  it('ISS-like orbit has a ~92 minute period; geostationary ~ one sidereal day', () => {
    expect(orbitalPeriod(6_778_000, MU_EARTH) / 60).toBeGreaterThan(91);
    expect(orbitalPeriod(6_778_000, MU_EARTH) / 60).toBeLessThan(93);
    expect(orbitalPeriod(42_164_000, MU_EARTH)).toBeCloseTo(86164, -2);
  });

  it('SOI radii match the textbook values', () => {
    const earth = soiRadius(1.495978707e11, MU_EARTH, MU_SUN);
    expect(earth / 1e9).toBeGreaterThan(0.92);
    expect(earth / 1e9).toBeLessThan(0.94);
    const moon = soiRadius(3.844e8, MU_MOON, MU_EARTH);
    expect(moon / 1e7).toBeGreaterThan(6.4);
    expect(moon / 1e7).toBeLessThan(6.8);
    const jupiter = soiRadius(7.7857e11, 1.26686534e17, MU_SUN);
    expect(jupiter / 1e10).toBeGreaterThan(4.7);
    expect(jupiter / 1e10).toBeLessThan(4.9);
  });
});

describe('orbitPoints', () => {
  it('traces a closed ellipse through periapsis and apoapsis', () => {
    const el: Elements = { a: 1e7, e: 0.3, i: 0.5, omegaNode: 1, omegaPeri: 2, M0: 0, epoch: 0 };
    const pts = orbitPoints(el, 90);
    expect(pts.length).toBe(91);
    const radii = pts.map(length);
    expect(Math.min(...radii)).toBeCloseTo(7e6, -1);
    expect(Math.max(...radii)).toBeCloseTo(1.3e7, -1);
    expect(length([pts[0]![0] - pts[90]![0], pts[0]![1] - pts[90]![1], pts[0]![2] - pts[90]![2]])).toBeLessThan(1e-3);
  });

  it('clips hyperbolas to the requested radius', () => {
    const el: Elements = { a: -2e7, e: 1.5, i: 0, omegaNode: 0, omegaPeri: 0, M0: 0, epoch: 0 };
    const pts = orbitPoints(el, 60, 1e9);
    expect(Math.max(...pts.map(length))).toBeLessThan(1.1e9);
    expect(Math.min(...pts.map(length))).toBeCloseTo(1e7, -2);
  });
});

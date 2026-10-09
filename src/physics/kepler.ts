/**
 * Two-body orbital mechanics: Kepler's equation, elements <-> state vectors, universal-variable propagation, spheres of
 * influence. Pure maths in double precision, no rendering imports. Vectors are plain [x, y, z] tuples in an arbitrary
 * right-handed reference frame whose +Z is the orbit reference normal (callers convert to world axes).
 */

export type Vec3 = [number, number, number];

export const TWO_PI = Math.PI * 2;

export interface Elements {
  /** Semi-major axis (m). Positive for ellipses, negative for hyperbolas. */
  a: number;
  e: number;
  /** Inclination, longitude of ascending node, argument of periapsis (radians). */
  i: number;
  omegaNode: number;
  omegaPeri: number;
  /** Mean anomaly at `epoch` (radians). */
  M0: number;
  /** Time (s) at which M0 applies. */
  epoch: number;
}

export interface State {
  r: Vec3;
  v: Vec3;
}

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Wrap an angle into [-pi, pi). */
export function wrapPi(x: number): number {
  const y = (x + Math.PI) % TWO_PI;
  return (y < 0 ? y + TWO_PI : y) - Math.PI;
}

/** Solve M = E - e sin E for the eccentric anomaly. Newton-Raphson with a safe starter; converges for 0 <= e < 1 (tested to 0.9999). */
export function solveKepler(M: number, e: number): number {
  const m = wrapPi(M);
  if (e < 1e-12) return m;
  // Starter: Danby's M + 0.85 e for moderate eccentricity; start at pi (monotone Newton convergence) when e is large.
  let E = e < 0.8 ? m + 0.85 * e * Math.sign(m || 1) : Math.PI * Math.sign(m || 1);
  for (let k = 0; k < 60; k++) {
    const s = Math.sin(E);
    const c = Math.cos(E);
    const f = E - e * s - m;
    const fp = 1 - e * c;
    const fpp = e * s;
    // Halley's method: cubic convergence, robust near the singular corner (e -> 1, M -> 0).
    const dE = -f / (fp - (f * fpp) / (2 * fp));
    E += dE;
    if (Math.abs(dE) < 1e-14) break;
  }
  return E;
}

/** Solve M = e sinh H - H for the hyperbolic anomaly (e > 1). */
export function solveKeplerHyperbolic(M: number, e: number): number {
  let H = Math.asinh(M / e);
  if (Math.abs(M) > 6) H = Math.sign(M) * Math.log((2 * Math.abs(M)) / e + 1.8);
  for (let k = 0; k < 80; k++) {
    const f = e * Math.sinh(H) - H - M;
    const fp = e * Math.cosh(H) - 1;
    const dH = -f / fp;
    H += dH;
    if (Math.abs(dH) < 1e-13 * Math.max(1, Math.abs(H))) break;
  }
  return H;
}

export const meanMotion = (a: number, mu: number): number => Math.sqrt(mu / Math.abs(a * a * a));
export const orbitalPeriod = (a: number, mu: number): number => TWO_PI / meanMotion(a, mu);

/** Rotate an in-plane vector (x towards periapsis) into the reference frame via (omegaPeri, i, omegaNode). */
function planeToFrame(x: number, y: number, el: Elements): Vec3 {
  const cw = Math.cos(el.omegaPeri);
  const sw = Math.sin(el.omegaPeri);
  const ci = Math.cos(el.i);
  const si = Math.sin(el.i);
  const cO = Math.cos(el.omegaNode);
  const sO = Math.sin(el.omegaNode);
  const x1 = x * cw - y * sw;
  const y1 = x * sw + y * cw;
  return [x1 * cO - y1 * ci * sO, x1 * sO + y1 * ci * cO, y1 * si];
}

/** State vector at time `t` (s) for gravitational parameter `mu`, in the reference frame. Handles ellipses and hyperbolas. */
export function elementsToState(el: Elements, mu: number, t: number): State {
  const n = meanMotion(el.a, mu);
  const M = el.M0 + n * (t - el.epoch);
  const e = el.e;
  if (e < 1) {
    const E = solveKepler(M, e);
    const cosE = Math.cos(E);
    const sinE = Math.sin(E);
    const r = el.a * (1 - e * cosE);
    const x = el.a * (cosE - e);
    const y = el.a * Math.sqrt(1 - e * e) * sinE;
    const k = (el.a * el.a * n) / r;
    return { r: planeToFrame(x, y, el), v: planeToFrame(-k * sinE, k * Math.sqrt(1 - e * e) * cosE, el) };
  }
  const H = solveKeplerHyperbolic(M, e);
  const coshH = Math.cosh(H);
  const sinhH = Math.sinh(H);
  const a = el.a; // negative
  const x = a * (coshH - e);
  const y = -a * Math.sqrt(e * e - 1) * sinhH;
  const dH = n / (e * coshH - 1);
  return { r: planeToFrame(x, y, el), v: planeToFrame(a * sinhH * dH, -a * Math.sqrt(e * e - 1) * coshH * dH, el) };
}

/** Elements from a state vector (frame +Z = reference normal). Degenerate planes/circles use the usual conventions (node = 0, periapsis along the node/eccentricity). */
export function stateToElements(state: State, mu: number, t = 0): Elements {
  const { r, v } = state;
  const rn = length(r);
  const v2 = dot(v, v);
  const h = cross(r, v);
  const hn = length(h);
  const eVec: Vec3 = scale(sub(scale(r, v2 - mu / rn), scale(v, dot(r, v))), 1 / mu);
  const e = length(eVec);
  const energy = v2 / 2 - mu / rn;
  const a = -mu / (2 * energy);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hn)));
  const nVec: Vec3 = [-h[1], h[0], 0];
  const nn = length(nVec);
  const eps = 1e-11;

  let omegaNode = 0;
  if (nn > eps * hn) omegaNode = Math.atan2(nVec[1], nVec[0]);

  let omegaPeri: number;
  if (e < eps) {
    omegaPeri = 0; // circular: measure the anomaly from the node (or x axis if equatorial)
  } else if (nn > eps * hn) {
    omegaPeri = Math.acos(Math.max(-1, Math.min(1, dot(nVec, eVec) / (nn * e))));
    if (eVec[2] < 0) omegaPeri = TWO_PI - omegaPeri;
  } else {
    omegaPeri = Math.atan2(eVec[1], eVec[0]) * Math.sign(h[2] || 1);
    if (omegaPeri < 0) omegaPeri += TWO_PI;
  }

  // True anomaly.
  let nu: number;
  if (e < eps) {
    const ref: Vec3 = nn > eps * hn ? [nVec[0] / nn, nVec[1] / nn, 0] : [1, 0, 0];
    nu = Math.acos(Math.max(-1, Math.min(1, dot(ref, r) / rn)));
    if (dot(cross(ref, r), h) < 0) nu = TWO_PI - nu;
  } else {
    nu = Math.acos(Math.max(-1, Math.min(1, dot(eVec, r) / (e * rn))));
    if (dot(r, v) < 0) nu = TWO_PI - nu;
  }

  let M0: number;
  if (e < 1) {
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    M0 = E - e * Math.sin(E);
  } else {
    const nuS = wrapPi(nu);
    const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nuS / 2));
    M0 = e * Math.sinh(H) - H;
  }
  return { a, e, i, omegaNode, omegaPeri, M0, epoch: t };
}

/** Advance a state by `dt` seconds using the universal-variable (Lagrange f and g) formulation: valid for every conic. */
export function propagate(state: State, mu: number, dt: number): State {
  const { r: r0, v: v0 } = state;
  const rn0 = length(r0);
  const vr0 = dot(r0, v0) / rn0;
  const alpha = 2 / rn0 - dot(v0, v0) / mu; // 1/a
  const sqrtMu = Math.sqrt(mu);

  const stumpffC = (z: number) => (z > 1e-8 ? (1 - Math.cos(Math.sqrt(z))) / z : z < -1e-8 ? (Math.cosh(Math.sqrt(-z)) - 1) / -z : 0.5 - z / 24 + (z * z) / 720);
  const stumpffS = (z: number) => {
    if (z > 1e-8) return (Math.sqrt(z) - Math.sin(Math.sqrt(z))) / Math.pow(z, 1.5);
    if (z < -1e-8) return (Math.sinh(Math.sqrt(-z)) - Math.sqrt(-z)) / Math.pow(-z, 1.5);
    return 1 / 6 - z / 120 + (z * z) / 5040;
  };

  // Whole periods of a closed orbit change nothing; dropping them keeps the iteration well-conditioned for long warps.
  if (alpha > 1e-15) {
    const period = TWO_PI * Math.sqrt(1 / (alpha * alpha * alpha) / mu);
    dt = dt % period;
  }
  let chi = Math.abs(alpha) > 1e-12 ? sqrtMu * Math.abs(alpha) * dt : (sqrtMu * dt) / rn0;
  for (let k = 0; k < 100; k++) {
    const z = alpha * chi * chi;
    const C = stumpffC(z);
    const S = stumpffS(z);
    const F = ((rn0 * vr0) / sqrtMu) * chi * chi * C + (1 - alpha * rn0) * chi * chi * chi * S + rn0 * chi - sqrtMu * dt;
    const dF = ((rn0 * vr0) / sqrtMu) * chi * (1 - z * S) + (1 - alpha * rn0) * chi * chi * C + rn0;
    const d = F / dF;
    chi -= d;
    if (Math.abs(d) < 1e-9 * Math.max(1, Math.abs(chi))) break;
  }
  const z = alpha * chi * chi;
  const C = stumpffC(z);
  const S = stumpffS(z);
  const f = 1 - (chi * chi * C) / rn0;
  const g = dt - (chi * chi * chi * S) / sqrtMu;
  const r = add(scale(r0, f), scale(v0, g));
  const rn = length(r);
  const fDot = (sqrtMu / (rn * rn0)) * (z * S - 1) * chi;
  const gDot = 1 - (chi * chi * C) / rn;
  return { r, v: add(scale(r0, fDot), scale(v0, gDot)) };
}

/** Radius of a body's sphere of influence about its parent: a (m/M)^(2/5). */
export const soiRadius = (a: number, muBody: number, muParent: number): number => a * Math.pow(muBody / muParent, 0.4);

/** Points along an orbit for drawing (uniform in eccentric/hyperbolic anomaly), in the reference frame. Hyperbolas are clipped to `maxRadius`. */
export function orbitPoints(el: Elements, count: number, maxRadius = Infinity): Vec3[] {
  const pts: Vec3[] = [];
  if (el.e < 1) {
    const b = el.a * Math.sqrt(1 - el.e * el.e);
    for (let k = 0; k <= count; k++) {
      const E = (k / count) * TWO_PI;
      pts.push(planeToFrame(el.a * (Math.cos(E) - el.e), b * Math.sin(E), el));
    }
    return pts;
  }
  const a = el.a;
  const b = -a * Math.sqrt(el.e * el.e - 1);
  const hMax = Math.acosh(Math.min(1e6, Math.max(1.0001, (1 + maxRadius / Math.abs(a)) / el.e)));
  for (let k = 0; k <= count; k++) {
    const H = -hMax + (2 * hMax * k) / count;
    pts.push(planeToFrame(a * (Math.cosh(H) - el.e), b * Math.sinh(H), el));
  }
  return pts;
}

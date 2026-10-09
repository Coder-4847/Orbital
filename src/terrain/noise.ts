/**
 * Deterministic 3D simplex noise (after Stefan Gustavson's public-domain reference) plus helpers.
 * Pure TS: identical results on the main thread and in workers, which is what makes terrain collision match visuals.
 */

const GRAD3 = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

function buildPermutation(seed: number): { perm: Uint8Array; permMod12: Uint8Array } {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // mulberry32 shuffle
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i]!;
    p[i] = p[j]!;
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255]!;
    permMod12[i] = perm[i]! % 12;
  }
  return { perm, permMod12 };
}

const F3 = 1 / 3;
const G3 = 1 / 6;

export class Simplex3 {
  private readonly perm: Uint8Array;
  private readonly permMod12: Uint8Array;

  constructor(seed = 1) {
    ({ perm: this.perm, permMod12: this.permMod12 } = buildPermutation(seed));
  }

  /** Noise in roughly [-1, 1]. */
  noise(xin: number, yin: number, zin: number): number {
    const perm = this.perm;
    const pm = this.permMod12;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);

    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

    let tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (tt > 0) {
      const g = pm[ii + perm[jj + perm[kk]!]!]! * 3;
      tt *= tt;
      n0 = tt * tt * (GRAD3[g]! * x0 + GRAD3[g + 1]! * y0 + GRAD3[g + 2]! * z0);
    }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (tt > 0) {
      const g = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]!]!]! * 3;
      tt *= tt;
      n1 = tt * tt * (GRAD3[g]! * x1 + GRAD3[g + 1]! * y1 + GRAD3[g + 2]! * z1);
    }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (tt > 0) {
      const g = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]!]!]! * 3;
      tt *= tt;
      n2 = tt * tt * (GRAD3[g]! * x2 + GRAD3[g + 1]! * y2 + GRAD3[g + 2]! * z2);
    }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (tt > 0) {
      const g = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]!]!]! * 3;
      tt *= tt;
      n3 = tt * tt * (GRAD3[g]! * x3 + GRAD3[g + 1]! * y3 + GRAD3[g + 2]! * z3);
    }
    return 32 * (n0 + n1 + n2 + n3);
  }

  /**
   * Fractal sum. `wavelength0` is the first octave's feature size in the same units as x,y,z.
   * Octaves with wavelength below `minWavelength` are skipped (nothing finer than the sampling grid can be seen).
   * Returns a value normalised so the sum of octave amplitudes is 1 (so result stays within about [-1,1]).
   */
  fbm(x: number, y: number, z: number, wavelength0: number, minWavelength: number, gain: number, maxOctaves = 24): number {
    let f = 1 / wavelength0;
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < maxOctaves; o++) {
      if (1 / f < minWavelength && o > 0) break;
      sum += amp * this.noise(x * f, y * f, z * f);
      norm += amp;
      amp *= gain;
      f *= 2.03; // slightly off 2 to avoid lattice alignment between octaves
    }
    return sum / norm;
  }
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

import { BODY_BY_ID } from '../data/solar-system';
import type { BodyProfile, Feature } from './body-profiles';
import { craterProfile, hash3 } from './craters';
import { lonLatToDirection } from './cube-sphere';
import { Simplex3, clamp, smoothstep } from './noise';
import type { SurfaceSample, TerrainSource } from './types';

const DEG = Math.PI / 180;

interface PreparedFeature extends Feature {
  dir: Float64Array;
  radiusM: number;
}

function featureShape(shape: Feature['shape'], x: number): number {
  if (x >= 1) return 0;
  switch (shape) {
    case 'dome':
      return Math.pow(1 - x * x, 1.6);
    case 'plateau':
      return smoothstep(1, 0.55, x);
    default:
      return smoothstep(1, 0.3, x); // bowl: flat floor, soft walls
  }
}

/**
 * A rocky or icy body described by a BodyProfile: fractal relief and ridges, an optional hemispheric dichotomy, landmark
 * features at real coordinates, a power-law crater population, and the albedo fields (tone, accent, ice) its surface
 * shader maps to colours. Deterministic and pure, like the Earth and Moon sources.
 */
export class ProceduralBodySource implements TerrainSource {
  readonly id: string;
  readonly radius: number;
  readonly maxHeight: number;

  private readonly relief: Simplex3;
  private readonly ridge: Simplex3;
  private readonly toneNoise: Simplex3;
  private readonly detailNoise: Simplex3;
  private readonly features: PreparedFeature[];
  private readonly dichotomyDir: Float64Array | null;

  constructor(private readonly profile: BodyProfile) {
    this.id = profile.id;
    this.radius = BODY_BY_ID.get(profile.id)!.radius;
    this.maxHeight = profile.maxHeight;
    this.relief = new Simplex3(profile.seed);
    this.ridge = new Simplex3(profile.seed + 1000);
    this.toneNoise = new Simplex3(profile.seed + 2000);
    this.detailNoise = new Simplex3(profile.seed + 3000);
    this.features = profile.features.map((f) => ({ ...f, dir: Float64Array.from(lonLatToDirection(f.lon * DEG, f.lat * DEG)), radiusM: f.radiusKm * 1000 }));
    this.dichotomyDir = profile.dichotomy ? Float64Array.from(lonLatToDirection(profile.dichotomy.lon * DEG, profile.dichotomy.lat * DEG)) : null;
  }

  sample(x: number, y: number, z: number, spacing: number, out: SurfaceSample): void {
    const p = this.profile;
    const R = this.radius;
    const px = x * R;
    const py = y * R;
    const pz = z * R;
    const minWl = Math.max(2 * spacing, 0.3);
    const lat = Math.asin(clamp(y, -1, 1));
    const absLatDeg = Math.abs(lat) / DEG;

    let h = this.relief.fbm(px, py, pz, p.relief.wavelength, minWl, p.relief.gain, 22) * p.relief.amplitude;
    if (p.ridges) {
      const r = 1 - Math.abs(this.ridge.fbm(px, py, pz, p.ridges.wavelength, minWl, 0.55, 18));
      h += (r * r - 0.4) * p.ridges.amplitude;
    }

    if (this.dichotomyDir && p.dichotomy) {
      const d = x * this.dichotomyDir[0]! + y * this.dichotomyDir[1]! + z * this.dichotomyDir[2]!;
      const edge = this.toneNoise.fbm(px, py, pz, 1_500_000, 50_000, 0.5, 6);
      h -= p.dichotomy.drop * smoothstep(-0.05, 0.3, d + edge * 0.25);
    }

    let tone = clamp(p.tone.bias + 0.5 * p.tone.contrast * this.toneNoise.fbm(px, py, pz, p.tone.wavelength, Math.max(minWl, p.tone.wavelength / 64), 0.55, 8), 0, 1);
    let accent = 0;
    let ice = 0;

    for (const f of this.features) {
      const dot = x * f.dir[0]! + y * f.dir[1]! + z * f.dir[2]!;
      const xr = (Math.acos(Math.min(1, dot)) * R) / f.radiusM;
      if (xr >= 1) continue;
      h += f.heightM * featureShape(f.shape, xr);
      const w = smoothstep(1, 0.4, xr);
      if (f.tone !== undefined) tone += (f.tone - tone) * w;
      if (f.accent !== undefined) accent += (f.accent - accent) * w;
      if (f.ice !== undefined) ice = Math.max(ice, f.ice * w);
    }

    const field = p.craters;
    if (field) {
      for (let diameter = field.maxDiameter, seed = 1; diameter > Math.max(minWl * 3, 3); diameter *= 0.55, seed++) {
        const cell = diameter * 1.9;
        const ix = Math.floor(px / cell);
        const iy = Math.floor(py / cell);
        const iz = Math.floor(pz / cell);
        const s = p.seed * 131 + seed;
        const occupancy = field.occupancy * Math.min(1, Math.pow(diameter / (0.08 * field.maxDiameter), 0.38));
        if (hash3(ix, iy, iz, s) > occupancy) continue;
        const jx = 0.18 + 0.64 * hash3(ix, iy, iz, s + 101);
        const jy = 0.18 + 0.64 * hash3(ix, iy, iz, s + 202);
        const jz = 0.18 + 0.64 * hash3(ix, iy, iz, s + 303);
        const size = diameter * (0.55 + 0.45 * hash3(ix, iy, iz, s + 404));
        const xr = Math.hypot(px - (ix + jx) * cell, py - (iy + jy) * cell, pz - (iz + jz) * cell) / (size / 2);
        if (xr > 3.2) continue;
        h += craterProfile(xr, size) * field.depthScale;
        if (field.darkFloors && xr < 0.9) tone = Math.max(tone, 1 - 0.3 * xr);
        const age = hash3(ix, iy, iz, s + 505);
        if (age > 1 - field.freshFraction) accent = Math.max(accent, ((age - (1 - field.freshFraction)) / field.freshFraction) * Math.exp(-((xr / 2.2) ** 2)));
      }
    }

    if (p.lineae) {
      const line = 1 - smoothstep(0, 0.1, Math.abs(this.detailNoise.fbm(px, py, pz, p.lineae.wavelength, Math.max(minWl, 2000), 0.5, 7)));
      tone = Math.max(tone, p.lineae.strength * line);
    }
    if (p.duneBelt) {
      const belt = 1 - smoothstep(p.duneBelt * 0.7, p.duneBelt * 1.1, absLatDeg);
      const dunes = this.detailNoise.fbm(px, py, pz, 200_000, Math.max(minWl, 3000), 0.5, 6);
      tone = tone + (1 - tone) * belt * smoothstep(-0.1, 0.3, dunes);
    }
    if (p.polarCaps) {
      const wobble = this.toneNoise.fbm(px, py, pz, 400_000, 20_000, 0.5, 5) * 3;
      ice = Math.max(ice, smoothstep(p.polarCaps.from, p.polarCaps.to, absLatDeg + wobble));
    }

    out.height = h;
    out.elevation = h;
    out.temperature = Math.cos(lat);
    out.moisture = 0;
    out.ice = ice;
    out.lights = 0;
    out.tone = clamp(tone, 0, 1);
    out.fresh = clamp(accent, 0, 1);
  }
}

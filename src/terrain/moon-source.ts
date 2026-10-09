import { craterProfile, hash3 } from './craters';
import { Simplex3, clamp, smoothstep } from './noise';
import { lonLatToDirection } from './cube-sphere';
import type { SurfaceSample, TerrainSource } from './types';

export const MOON_RADIUS = 1_737_400;
const DEG = Math.PI / 180;

interface Feature {
  name: string;
  lon: number; // degrees east
  lat: number; // degrees north
  radiusKm: number;
}

/** Major maria (dark basalt plains). Positions from standard selenographic coordinates. */
const MARIA: Feature[] = [
  { name: 'Imbrium', lon: -15.6, lat: 32.8, radiusKm: 560 },
  { name: 'Serenitatis', lon: 17.5, lat: 28, radiusKm: 350 },
  { name: 'Tranquillitatis', lon: 31.4, lat: 8.5, radiusKm: 440 },
  { name: 'Crisium', lon: 59.1, lat: 17, radiusKm: 255 },
  { name: 'Fecunditatis', lon: 51.3, lat: -7.8, radiusKm: 420 },
  { name: 'Nectaris', lon: 34.6, lat: -15.2, radiusKm: 170 },
  { name: 'Nubium', lon: -16.6, lat: -21.3, radiusKm: 340 },
  { name: 'Humorum', lon: -38.6, lat: -24.4, radiusKm: 200 },
  { name: 'Cognitum', lon: -23.1, lat: -10.7, radiusKm: 190 },
  { name: 'Vaporum', lon: 3.6, lat: 13.3, radiusKm: 120 },
  { name: 'Frigoris', lon: 1, lat: 56, radiusKm: 330 },
  { name: 'Procellarum N', lon: -50, lat: 30, radiusKm: 520 },
  { name: 'Procellarum S', lon: -55, lat: 5, radiusKm: 620 },
  { name: 'Moscoviense', lon: 147.9, lat: 27.3, radiusKm: 140 },
  { name: 'Orientale', lon: -92.8, lat: -19.4, radiusKm: 150 },
];

interface NamedCrater {
  lon: number;
  lat: number;
  diameterKm: number;
  fresh: number;
}

/** Landmark craters; fresh = ejecta brightness (young craters like Tycho and Copernicus are bright). */
const NAMED_CRATERS: NamedCrater[] = [
  { lon: -11.4, lat: -43.3, diameterKm: 85, fresh: 1 }, // Tycho
  { lon: -20.1, lat: 9.6, diameterKm: 93, fresh: 0.85 }, // Copernicus
  { lon: -38, lat: 8.1, diameterKm: 31, fresh: 0.7 }, // Kepler
  { lon: -47.4, lat: 23.7, diameterKm: 40, fresh: 0.95 }, // Aristarchus
  { lon: -9.3, lat: 51.6, diameterKm: 101, fresh: 0.15 }, // Plato
  { lon: -14.4, lat: -58.4, diameterKm: 225, fresh: 0.2 }, // Clavius
  { lon: 61.1, lat: -8.9, diameterKm: 132, fresh: 0.3 }, // Langrenus
  { lon: 26.4, lat: -11.4, diameterKm: 100, fresh: 0.3 }, // Theophilus
  { lon: 60.4, lat: -25.2, diameterKm: 177, fresh: 0.25 }, // Petavius
  { lon: -68.3, lat: -5.2, diameterKm: 172, fresh: 0.2 }, // Grimaldi
  { lon: -60.2, lat: -0.7, diameterKm: 40, fresh: 0.5 }, // Lohrmann-ish
  { lon: 4.7, lat: 59.7, diameterKm: 58, fresh: 0.3 }, // Archimedes-ish north
  { lon: -3.2, lat: 29.7, diameterKm: 83, fresh: 0.3 }, // Archimedes
  { lon: 128.9, lat: 5.3, diameterKm: 150, fresh: 0.3 }, // far-side basin crater
  { lon: -153, lat: -2, diameterKm: 200, fresh: 0.25 },
  { lon: 100, lat: -40, diameterKm: 180, fresh: 0.35 },
];

/**
 * The Moon: real maria and landmark craters at their selenographic positions, plus a procedural crater population
 * (power-law sizes from ~300 km down to metres) and fractal highlands. All craters are evaluated with a single
 * jittered-grid lookup per size class, so a sample costs ~20 hash lookups.
 */
export class MoonSource implements TerrainSource {
  readonly id = 'moon';
  readonly radius = MOON_RADIUS;
  readonly maxHeight = 11_000;

  private readonly noise = new Simplex3(101);
  private readonly noise2 = new Simplex3(202);
  private readonly mariaDirs: Float64Array[];
  private readonly craterDirs: Float64Array[];
  private readonly basinDir: Float64Array;

  constructor() {
    this.mariaDirs = MARIA.map((m) => Float64Array.from(lonLatToDirection(m.lon * DEG, m.lat * DEG)));
    this.craterDirs = NAMED_CRATERS.map((c) => Float64Array.from(lonLatToDirection(c.lon * DEG, c.lat * DEG)));
    this.basinDir = Float64Array.from(lonLatToDirection(-169 * DEG, -53 * DEG)); // South Pole-Aitken basin
  }

  sample(x: number, y: number, z: number, spacing: number, out: SurfaceSample): void {
    const R = MOON_RADIUS;
    const px = x * R;
    const py = y * R;
    const pz = z * R;
    const minWl = Math.max(2 * spacing, 0.3);

    // Near side faces +X (lon 0). Far side highlands are higher on average.
    const nearSide = smoothstep(-0.25, 0.35, x);
    let h = this.noise.fbm(px, py, pz, 2_500_000, minWl, 0.6, 22) * 1700 + (1 - nearSide) * 1300;

    // Maria: low, flat, dark.
    let mare = 0;
    const edgeNoise = this.noise2.fbm(px, py, pz, 400_000, Math.max(minWl, 3000), 0.5, 6);
    for (let k = 0; k < MARIA.length; k++) {
      const d = this.mariaDirs[k]!;
      const ang = Math.acos(Math.min(1, x * d[0]! + y * d[1]! + z * d[2]!));
      const distKm = (ang * R) / 1000;
      const m = smoothstep(1.08, 0.86, distKm / MARIA[k]!.radiusKm + edgeNoise * 0.16);
      if (m > mare) mare = m;
    }
    h = (h - 2300 * mare) * (1 - 0.55 * mare); // lower and flatten the floors

    // South Pole-Aitken basin.
    const bAng = Math.acos(Math.min(1, x * this.basinDir[0]! + y * this.basinDir[1]! + z * this.basinDir[2]!));
    const bx = (bAng * R) / 1_250_000;
    if (bx < 1.4) h -= 5200 * smoothstep(1.2, 0.2, bx);

    let fresh = 0;

    // Landmark craters.
    for (let k = 0; k < NAMED_CRATERS.length; k++) {
      const c = NAMED_CRATERS[k]!;
      const d = this.craterDirs[k]!;
      const ang = Math.acos(Math.min(1, x * d[0]! + y * d[1]! + z * d[2]!));
      const rM = (c.diameterKm * 1000) / 2;
      const xr = (ang * R) / rM;
      if (xr > 4) continue;
      h += craterProfile(xr, c.diameterKm * 1000);
      fresh = Math.max(fresh, c.fresh * Math.exp(-((xr / 2.4) ** 2)));
    }

    // Procedural crater population: one jittered-grid cell lookup per size class (diameter halves each class).
    for (let diameter = 260_000, seed = 1; diameter > Math.max(40, minWl * 3); diameter *= 0.55, seed++) {
      const cell = diameter * 1.9;
      const ix = Math.floor(px / cell);
      const iy = Math.floor(py / cell);
      const iz = Math.floor(pz / cell);
      const hRand = hash3(ix, iy, iz, seed);
      // Big craters are common targets; small ones overlap into a soft regolith, so occupancy falls with size.
      const occupancy = Math.min(0.62, 0.62 * Math.pow(diameter / 30_000, 0.38));
      if (hRand > occupancy) continue;
      const jx = 0.18 + 0.64 * hash3(ix, iy, iz, seed + 101);
      const jy = 0.18 + 0.64 * hash3(ix, iy, iz, seed + 202);
      const jz = 0.18 + 0.64 * hash3(ix, iy, iz, seed + 303);
      const size = diameter * (0.55 + 0.45 * hash3(ix, iy, iz, seed + 404));
      const dx = px - (ix + jx) * cell;
      const dy = py - (iy + jy) * cell;
      const dz = pz - (iz + jz) * cell;
      const xr = Math.hypot(dx, dy, dz) / (size / 2);
      if (xr > 3.2) continue;
      // Craters inside maria are shallower (flooded) and older.
      const flood = 1 - 0.6 * mare;
      h += craterProfile(xr, size) * flood;
      const age = hash3(ix, iy, iz, seed + 505);
      if (age > 0.9) fresh = Math.max(fresh, (age - 0.9) * 10 * Math.exp(-((xr / 2.2) ** 2)));
    }

    out.height = h;
    out.elevation = h;
    out.temperature = 0;
    out.moisture = 0;
    out.ice = 0;
    out.lights = 0;
    out.tone = clamp(mare, 0, 1);
    out.fresh = clamp(fresh, 0, 1);
  }
}

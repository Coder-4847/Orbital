import { LAUNCH_SITES, PAD_BLEND_RADIUS, PAD_FLAT_RADIUS } from '../data/sites';
import { lowlandDistance } from './lowlands';
import { Simplex3, clamp, mix, smoothstep } from './noise';
import { sampleRaster, type Raster8 } from './sampling';
import type { SurfaceSample, TerrainSource } from './types';

export interface EarthData {
  /** 8-bit land elevation: 0 = ocean/sea level, 255 = 8848 m. 4096x2048 equirectangular. */
  elevation: Raster8;
  /** 8-bit anti-aliased land coverage (255 = land); the 0.5 contour is the coastline, accurate to well under a pixel. */
  land: Raster8;
  /** 8-bit distance from land over ocean, 10 km per step. 1024x512. */
  coast: Raster8;
  /** 8-bit night-light density. 1024x512. */
  lights: Raster8;
}

export const EARTH_RADIUS = 6_371_000;
const MAX_ELEVATION = 8848;
/** Half-width (km) of the band over which a lowland outline turns from sea to land; the coast's fractal jitter lives inside it. */
const LOW_COAST_KM = 10;

/** Unit directions of the launch pads, whose ground is levelled so a rocket (and its pad) can stand on it. */
const PADS = LAUNCH_SITES.map((s) => {
  const lon = (s.lon * Math.PI) / 180;
  const lat = (s.lat * Math.PI) / 180;
  return { x: Math.cos(lat) * Math.cos(lon), y: Math.sin(lat), z: -Math.cos(lat) * Math.sin(lon), height: s.height };
});

/**
 * Earth: real continents and relief from a baked NASA heightmap, with fractal detail added down to sub-metre scale.
 * Everything below the data resolution (~10 km) is procedural but deterministic, so workers and the main thread agree.
 */
export class EarthSource implements TerrainSource {
  readonly id = 'earth';
  readonly radius = EARTH_RADIUS;
  readonly maxHeight = 9500;

  private readonly coastNoise = new Simplex3(11);
  private readonly detailNoise = new Simplex3(23);
  private readonly ridgeNoise = new Simplex3(37);
  private readonly climateNoise = new Simplex3(53);

  constructor(private readonly data: EarthData) {}

  sample(x: number, y: number, z: number, spacing: number, out: SurfaceSample): void {
    const lon = Math.atan2(-z, x);
    const lat = Math.asin(clamp(y, -1, 1));
    const px = x * EARTH_RADIUS;
    const py = y * EARTH_RADIUS;
    const pz = z * EARTH_RADIUS;
    const minWl = Math.max(2 * spacing, 0.4);

    const e = sampleRaster(this.data.elevation, lon, lat) / 255;
    let coverage = sampleRaster(this.data.land, lon, lat) / 255;
    let dataH = e * MAX_ELEVATION;

    // Coastal plains too low for the heightmap (see lowlands.ts): their outline supplies the coast, and the ground rises
    // gently inland from a metre or two at the shore.
    const lowKm = lowlandDistance((lon * 180) / Math.PI, (lat * 180) / Math.PI);
    if (lowKm > -LOW_COAST_KM) {
      coverage = Math.max(coverage, clamp(0.5 + lowKm / (2 * LOW_COAST_KM), 0, 1));
      if (lowKm > 0) dataH = Math.max(dataH, 1.5 + 30 * smoothstep(0, 90, lowKm));
    }

    // The coastline is the iso-contour coverage = theta (0.5 reproduces the real coast sub-pixel). The fractal jitter
    // of theta gives natural, scale-free wiggles; far from the coast coverage is 0 or 1, so it cannot create islands.
    const coastJitter = this.coastNoise.fbm(px, py, pz, 20000, minWl, 0.6, 18);
    const theta = 0.5 + 0.13 * coastJitter;
    // Land rises from sea level at the coastline: height eases in over the first third of a pixel of coverage.
    const edge = smoothstep(theta, theta + 0.3, coverage);
    // A lowland shore climbs to a few metres within a kilometre (dunes), instead of staying awash for the width of the data's coast ramp.
    const dune = lowKm > -LOW_COAST_KM ? 3.4 * smoothstep(theta, theta + 0.04, coverage) : 0;
    const landH = coverage > theta ? Math.max(dataH * edge, dune, 0.4) : 0;

    let height = 0;
    let elevation = 0;
    if (landH > 0) {
      const amp = smoothstep(0.4, 40, landH);
      const rough = mix(0.05, 1, smoothstep(100, 2500, landH));
      let detail = this.detailNoise.fbm(px, py, pz, 160000, minWl, 0.62, 22) * rough * 2600;
      const mountains = smoothstep(1200, 4000, landH);
      if (mountains > 0) {
        const ridge = 1 - Math.abs(this.ridgeNoise.fbm(px, py, pz, 50000, minWl, 0.55, 20));
        detail += (ridge * ridge - 0.45) * mountains * 1400;
      }
      const h = landH + detail * amp;
      if (h > 0) {
        height = h;
        elevation = h;
      } else {
        elevation = -3; // a puddle on a coastal plain: shallow water
      }
    }

    // Level the ground under launch pads: exactly flat near the pad, blending back into the natural terrain.
    let padLevelled = false;
    for (const pad of PADS) {
      const d = EARTH_RADIUS * Math.acos(clamp(x * pad.x + y * pad.y + z * pad.z, -1, 1));
      if (d < PAD_BLEND_RADIUS) {
        const w = 1 - smoothstep(PAD_FLAT_RADIUS, PAD_BLEND_RADIUS, d);
        height = mix(height, pad.height, w);
        elevation = mix(elevation, pad.height, w);
        padLevelled = true;
      }
    }
    const water = height === 0 && !padLevelled;
    if (water && landH <= 0) {
      const coastKm = Math.min((sampleRaster(this.data.coast, lon, lat) / 255) * 2550, Math.max(0, -lowKm));
      const shelfWidth = 0.55 + 0.9 * (0.5 + 0.5 * this.climateNoise.fbm(px, py, pz, 900000, 100000, 0.5, 4)); // steep vs gentle coasts
      const d = coastKm / shelfWidth;
      const floorNoise = this.detailNoise.fbm(px, py, pz, 500000, Math.max(minWl, 2000), 0.55, 10);
      elevation = -(8 + 140 * smoothstep(0, 80, d) + 3900 * smoothstep(60, 650, d) + 700 * smoothstep(650, 2200, d) + floorNoise * 450 * smoothstep(40, 400, d));
    }

    // --- Climate (cheap latitude/elevation model; real deserts roughly emerge from the subtropical dry belt) ---
    const elevKm = Math.max(0, height) / 1000;
    const absLatDeg = (Math.abs(lat) * 180) / Math.PI;
    const cosLat = Math.cos(lat);
    const tNoise = this.climateNoise.fbm(px, py, pz, 1_200_000, 60000, 0.5, 5);
    const temperature = clamp(Math.pow(cosLat, 1.25) - 0.125 * elevKm + tNoise * 0.05, 0, 1);

    const tropics = 0.75 * Math.exp(-((absLatDeg / 12) ** 2));
    const temperate = 0.42 * Math.exp(-(((absLatDeg - 52) / 16) ** 2));
    const mNoise = this.climateNoise.fbm(px + 1e6, py - 3e6, pz + 2e6, 1_800_000, 80000, 0.5, 5);
    // The plains in lowlands.ts are humid subtropical coast, which the latitude model would paint as desert.
    const humid = 0.5 * smoothstep(-LOW_COAST_KM, 4, lowKm);
    const moisture = clamp(0.1 + tropics + temperate + humid + mNoise * 0.45 - 0.05 * elevKm, 0, 1);

    let ice = 0;
    if (!water) ice = smoothstep(0.2, 0.09, temperature);
    else ice = smoothstep(0.13, 0.05, temperature + tNoise * 0.04);

    out.height = height;
    out.elevation = elevation;
    out.temperature = temperature;
    out.moisture = moisture;
    out.ice = ice;
    out.lights = water ? 0 : (sampleRaster(this.data.lights, lon, lat) / 255) * (1 - ice);
    out.tone = 0;
    out.fresh = 0;
  }
}

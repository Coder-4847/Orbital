/**
 * Atmosphere description and CPU reference maths (no rendering imports: unit-tested, also drives exposure).
 * Model after Hillaire 2020 / Bruneton 2008: Rayleigh + Mie + ozone absorption with exponential density profiles.
 * All distances are metres, coefficients are per metre.
 */

export type Vec3 = [number, number, number];

/** A tent-shaped layer (ozone, cloud deck, methane haze): scatters and/or absorbs, centred at a height with a half-width. */
export interface AtmosphereLayer {
  centre: number;
  halfWidth: number;
  scattering: Vec3;
  absorption: Vec3;
  /** Henyey-Greenstein asymmetry of the layer's scattering. */
  g: number;
}

export interface AtmosphereDef {
  /** Planet surface (1 bar level for gas giants) and top-of-atmosphere radius (m). */
  radius: number;
  topRadius: number;
  rayleighScattering: Vec3;
  rayleighScaleHeight: number;
  /** Exponential aerosol/dust/haze component, per colour channel. */
  mieScattering: Vec3;
  mieAbsorption: Vec3;
  mieScaleHeight: number;
  /** Henyey-Greenstein asymmetry of the Mie component. */
  mieG: number;
  /** One extra layer: Earth's ozone, Venus's cloud deck, the methane that makes Uranus and Neptune blue. */
  layer: AtmosphereLayer | null;
  /**
   * An opaque cloud deck drawn as a lit shell (Venus). A volumetric layer this thick cannot be ray-marched: its lit skin is a
   * few hundred metres deep and falls between samples.
   */
  deck?: { altitude: number; albedo: Vec3 };
}

export const EARTH_ATMOSPHERE: AtmosphereDef = {
  radius: 6_371_000,
  topRadius: 6_371_000 + 80_000,
  rayleighScattering: [5.802e-6, 13.558e-6, 33.1e-6],
  rayleighScaleHeight: 8000,
  mieScattering: [3.996e-6, 3.996e-6, 3.996e-6],
  mieAbsorption: [0.44e-6, 0.44e-6, 0.44e-6],
  mieScaleHeight: 1200,
  mieG: 0.8,
  layer: { centre: 25_000, halfWidth: 15_000, scattering: [0, 0, 0], absorption: [0.65e-6, 1.881e-6, 0.085e-6], g: 0 },
};

/** Sun irradiance above the atmosphere, in render units. A white diffuse surface (albedo 1) facing the sun has radiance E/pi. */
export const SUN_IRRADIANCE: Vec3 = [5, 4.9, 4.65];

/** Extinction coefficients (per metre, RGB) at height h above the surface. */
export function extinctionAt(def: AtmosphereDef, h: number, out: Vec3): Vec3 {
  const dr = Math.exp(-h / def.rayleighScaleHeight);
  const dm = Math.exp(-h / def.mieScaleHeight);
  const L = def.layer;
  const tent = L ? Math.max(0, 1 - Math.abs(h - L.centre) / L.halfWidth) : 0;
  for (let c = 0; c < 3; c++) {
    out[c] = def.rayleighScattering[c]! * dr + (def.mieScattering[c]! + def.mieAbsorption[c]!) * dm + (L ? (L.scattering[c]! + L.absorption[c]!) * tent : 0);
  }
  return out;
}

/** Distance from (r, mu) to the top of the atmosphere along the ray. */
export function distanceToTop(def: AtmosphereDef, r: number, mu: number): number {
  const disc = r * r * mu * mu - r * r + def.topRadius * def.topRadius;
  return -r * mu + Math.sqrt(Math.max(disc, 0));
}

/** mu of the geometric horizon seen from radius r (rays below it hit the planet). */
export function horizonMu(def: AtmosphereDef, r: number): number {
  return r <= def.radius ? 0 : -Math.sqrt(1 - (def.radius * def.radius) / (r * r));
}

/**
 * Transmittance from radius r towards direction mu (cosine of angle to the local vertical) to the top of the atmosphere.
 * Returns zero when the ray would hit the planet (that is how the planet shadows the sun).
 * Sun-disc softening: the cut-off is smoothed over the sun's angular radius.
 */
export function transmittanceToTop(def: AtmosphereDef, r: number, mu: number, steps = 48): Vec3 {
  const rr = Math.max(r, def.radius);
  const muH = horizonMu(def, rr);
  const vis = smooth(muH - 0.006, muH + 0.002, mu);
  if (vis <= 0) return [0, 0, 0];
  const m = Math.max(mu, muH);
  const d = distanceToTop(def, rr, m);
  const dt = d / steps;
  const ext: Vec3 = [0, 0, 0];
  let o0 = 0, o1 = 0, o2 = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const ri = Math.sqrt(rr * rr + t * t + 2 * rr * m * t);
    extinctionAt(def, ri - def.radius, ext);
    o0 += ext[0]! * dt;
    o1 += ext[1]! * dt;
    o2 += ext[2]! * dt;
  }
  return [Math.exp(-o0) * vis, Math.exp(-o1) * vis, Math.exp(-o2) * vis];
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const luminance = (c: Vec3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Scene "key" luminance for exposure: how bright a mid-grey surface at the camera is, given the sun's elevation.
 * `sinSun` is the sine of the sun's elevation at the camera (dot of local up and sun direction).
 */
export function keyLuminance(def: AtmosphereDef | null, altitude: number, sinSun: number): number {
  const E = luminance(SUN_IRRADIANCE);
  const albedo = 0.3;
  if (!def) return (albedo * E * Math.max(sinSun, 0.0)) / Math.PI;
  const r = def.radius + Math.max(altitude, 0);
  const t = luminance(transmittanceToTop(def, r, sinSun));
  const direct = (albedo * E * t * Math.max(sinSun, 0)) / Math.PI;
  // Skylight stays up in twilight: use the sun's transmittance at 10 km altitude, where the horizon has dipped below.
  const t10 = luminance(transmittanceToTop(def, def.radius + 10_000, sinSun));
  const vertical = luminance(transmittanceToTop(def, r, 1));
  const sky = (albedo * E * t10 * (1 - vertical) * 0.55) / Math.PI;
  return direct + sky + 0.0004; // + starlight floor
}

/** Reference (daylight) key luminance; exposure 1 corresponds to this. */
export const REFERENCE_KEY_LUMINANCE = (0.3 * luminance(SUN_IRRADIANCE)) / Math.PI;

/**
 * Exposure for a key luminance. Adaptation is deliberately partial (exponent < 1), like an eye or a camera with
 * highlight protection: a low sun brightens the scene but does not fully normalise it, so sunsets still look like sunsets.
 */
export function exposureForKey(key: number): number {
  const full = REFERENCE_KEY_LUMINANCE / Math.max(key, 1e-9);
  return Math.min(Math.max(Math.pow(full, 0.62), 0.7), 160);
}

/**
 * Exposure for an observer inside an atmosphere, as a function of the sun's elevation (degrees). A person or camera adapts
 * to the *sky*, not to the dim ground, so exposure rises much more slowly through twilight than ground illumination falls.
 * Hand-tuned control points, interpolated in log space; capped so the night sky stays dark but readable.
 */
const TWILIGHT_EXPOSURE: ReadonlyArray<readonly [number, number]> = [
  [-18, 150],
  [-14, 95],
  [-10, 42],
  [-6, 14],
  [-3, 6.5],
  [0, 3.6],
  [5, 2.3],
  [15, 1.5],
  [35, 1.0],
];

export function exposureForSunElevation(elevationDeg: number): number {
  const pts = TWILIGHT_EXPOSURE;
  if (elevationDeg <= pts[0]![0]) return pts[0]![1];
  if (elevationDeg >= pts[pts.length - 1]![0]) return pts[pts.length - 1]![1];
  for (let i = 1; i < pts.length; i++) {
    const [e1, x1] = pts[i]!;
    if (elevationDeg <= e1) {
      const [e0, x0] = pts[i - 1]!;
      const t = (elevationDeg - e0) / (e1 - e0);
      return Math.exp(Math.log(x0) * (1 - t) + Math.log(x1) * t);
    }
  }
  return 1;
}

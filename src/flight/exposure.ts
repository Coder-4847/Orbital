/**
 * Camera exposure model for the whole solar system: what the "eye" is adapted to at a given place. Pure maths.
 *   - On a world with air: the perceptual daylight/twilight curve for the Sun's elevation, scaled for the Sun's distance.
 *   - On an airless world: the physical luminance of sunlit ground.
 *   - In space: neutral near Earth's distance from the Sun, opening up near dim far worlds (Saturn gets 1/90 of Earth's
 *     sunlight) and closing down near bright ones (Mercury gets 6x), and very short when staring at the Sun itself.
 * The three regimes are blended by altitude so flying away from a planet adapts smoothly.
 */
import { exposureForKey, exposureForSunElevation, keyLuminance } from '../render/atmosphere-model';

export interface ExposureInput {
  isStar: boolean;
  /** Atmosphere thickness (top radius - surface radius, m), or 0 for an airless body. */
  atmosphereHeight: number;
  bodyRadius: number;
  /** Camera height above the surface (m). */
  altitude: number;
  /** Sine of the Sun's elevation at the camera (dot of local up and the direction to the Sun). */
  sinSun: number;
  /** Sunlight at this body relative to Earth's distance (1/d^2 in AU). */
  irradianceScale: number;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);
const smoothstep = (x: number, lo: number, hi: number): number => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The exposure multiplier the camera should settle on. */
export function targetExposure(i: ExposureInput): number {
  const hasAir = i.atmosphereHeight > 0;
  const H = i.atmosphereHeight;
  // Surface-observer regime fades out above ~3 atmosphere heights (or ~20 km without air).
  const onSurface = hasAir ? 1 - smoothstep(i.altitude, 0.75 * H, 3 * H) : 1 - smoothstep(i.altitude, 2_000, 20_000);

  let surface: number;
  if (i.isStar) {
    surface = 0.02; // staring at the Sun: a very short exposure
  } else if (hasAir) {
    surface = exposureForSunElevation((Math.asin(clamp(i.sinSun, -1, 1)) * 180) / Math.PI);
    surface *= Math.pow(1 / i.irradianceScale, 0.62); // dimmer sunlight at Mars or Titan: open the aperture a little
  } else {
    surface = exposureForKey(keyLuminance(null, i.altitude, i.sinSun) * i.irradianceScale);
  }
  const blend = i.isStar ? 1 - smoothstep(i.altitude, i.bodyRadius * 2, i.bodyRadius * 40) : onSurface;

  // In space near a lit world: compensate fully for the Sun's distance, fading to neutral within a couple hundred radii.
  const near = 1 - smoothstep(i.altitude / i.bodyRadius, 8, 200);
  const space = clamp(1 / i.irradianceScale, 0.03, 200) * near + (1 - near);

  return Math.exp(blend * Math.log(Math.max(surface, 1e-4)) + (1 - blend) * Math.log(space));
}

/**
 * Move the current exposure towards the target in log space: fast when the scene gets brighter (exposure falls),
 * slow when it gets darker, or jump at once (after a teleport).
 */
export function adaptExposure(current: number, target: number, dt: number, snap: boolean): number {
  const tau = target < current ? 0.45 : 2.2;
  const k = snap ? 1 : 1 - Math.exp(-dt / tau);
  return Math.exp(Math.log(current) + (Math.log(target) - Math.log(current)) * k);
}

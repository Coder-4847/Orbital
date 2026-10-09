/**
 * Lighting for the vessel and the pad: the sun's colour and strength after it has crossed the atmosphere above the vessel
 * (reddening towards sunset, zero in the planet's shadow), the sky's ambient light and the ground bounce. Uses the same CPU
 * atmosphere model the shaders were validated against, so a rocket and the terrain behind it are lit consistently.
 */
import { AU } from '../data/solar-system';
import { EARTH_ATMOSPHERE, SUN_IRRADIANCE, transmittanceToTop, type AtmosphereDef, type Vec3 } from '../render/atmosphere-model';

export interface SceneLight {
  /** Direct sun irradiance (RGB) and the ambient sky and ground colours (irradiance, RGB). */
  sun: Vec3;
  sky: Vec3;
  ground: Vec3;
  /** 0..1 how much daylight there is (for smoke and the environment map). */
  daylight: number;
}

const scaled = (c: Vec3, k: number): Vec3 => [c[0] * k, c[1] * k, c[2] * k];

/**
 * `radius` is the vessel's distance from the planet's centre, `sinSun` the sine of the sun's elevation there, `sunDistance`
 * the planet's distance from the Sun (m).
 */
export function lightingAt(radius: number, sinSun: number, sunDistance: number, def: AtmosphereDef | null = EARTH_ATMOSPHERE, bodyRadius = 6.371e6, unshadowed = false): SceneLight {
  const e = scaled(SUN_IRRADIANCE, (AU / Math.max(sunDistance, 1)) ** 2);
  if (!def) {
    const lit = unshadowed || sinSun > -Math.sqrt(Math.max(0, 1 - (bodyRadius / radius) ** 2)) ? 1 : 0; // crude shadow test above a bare planet
    return { sun: scaled(e, lit), sky: [0, 0, 0], ground: scaled(e, 0.03 * lit), daylight: lit };
  }
  const t = transmittanceToTop(def, radius, sinSun, 24);
  const sun: Vec3 = [e[0] * t[0], e[1] * t[1], e[2] * t[2]];
  const vertical = transmittanceToTop(def, radius, 1, 24);
  const twilight = transmittanceToTop(def, def.radius + 10_000, sinSun, 24);
  const sky: Vec3 = [0, 1, 2].map((i) => e[i]! * (1 - vertical[i]!) * 0.55 * twilight[i]! + e[i]! * 0.00018) as Vec3;
  const bounce = Math.max(0, sinSun) * 0.12; // light reflected off the ground back up at the underside
  const ground: Vec3 = [0, 1, 2].map((i) => sky[i]! * 0.5 + sun[i]! * bounce * 0.3) as Vec3;
  const daylight = Math.min(1, (0.2126 * sun[0] + 0.7152 * sun[1] + 0.0722 * sun[2]) / 3 + 0.5 * Math.min(1, (sky[0] + sky[1] + sky[2]) / 3));
  return { sun, sky, ground, daylight };
}

/**
 * Atmosphere models per body. Earth follows Hillaire (2020); the others are physically motivated but art-directed
 * single-scattering models that reproduce each world's look: Venus's opaque yellow cloud deck, Mars's butterscotch
 * dust sky, Titan's orange haze, and the methane-absorbing blue of Uranus and Neptune.
 */
import { EARTH_ATMOSPHERE, type AtmosphereDef, type Vec3 } from '../render/atmosphere-model';
import { bodyDef } from './solar-system';

const EARTH_RAYLEIGH = EARTH_ATMOSPHERE.rayleighScattering;
const times = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];

const top = (id: string, height: number): { radius: number; topRadius: number } => ({ radius: bodyDef(id).radius, topRadius: bodyDef(id).radius + height });
const none: Vec3 = [0, 0, 0];

export const ATMOSPHERES: Record<string, AtmosphereDef> = {
  earth: EARTH_ATMOSPHERE,

  // Dense CO2 fog below, an opaque sulphuric-acid cloud deck at ~48-70 km that gives the pale yellow disc.
  venus: {
    ...top('venus', 100_000),
    rayleighScattering: times(EARTH_RAYLEIGH, 6),
    rayleighScaleHeight: 15_900,
    mieScattering: [4e-6, 4e-6, 4e-6],
    mieAbsorption: [1e-7, 1e-7, 1e-7],
    mieScaleHeight: 6000,
    mieG: 0.5,
    layer: null,
    // The sulphuric-acid cloud deck: opaque, pale yellow (UV absorbers darken it in streaks).
    deck: { altitude: 65_000, albedo: [0.93, 0.84, 0.56] },
  },

  // Very thin CO2 with suspended dust: reddish-butterscotch sky, bluish sunsets.
  mars: {
    ...top('mars', 100_000),
    rayleighScattering: times(EARTH_RAYLEIGH, 0.012),
    rayleighScaleHeight: 11_100,
    mieScattering: [3.2e-5, 2.8e-5, 2.0e-5],
    mieAbsorption: [3e-6, 8e-6, 1.7e-5],
    mieScaleHeight: 10_000,
    mieG: 0.65,
    layer: null,
  },

  // Thick nitrogen atmosphere with a deep orange photochemical haze.
  titan: {
    ...top('titan', 500_000),
    rayleighScattering: times(EARTH_RAYLEIGH, 4),
    rayleighScaleHeight: 21_000,
    mieScattering: [2.2e-4, 1.5e-4, 8e-5],
    mieAbsorption: [1e-5, 5e-5, 1.4e-4],
    mieScaleHeight: 60_000,
    mieG: 0.35,
    layer: null,
  },

  jupiter: {
    ...top('jupiter', 300_000),
    rayleighScattering: times(EARTH_RAYLEIGH, 0.3),
    rayleighScaleHeight: 27_000,
    mieScattering: [1.2e-5, 1.2e-5, 1.2e-5],
    mieAbsorption: [1e-6, 4e-6, 1e-5],
    mieScaleHeight: 40_000,
    mieG: 0.6,
    layer: null,
  },

  saturn: {
    ...top('saturn', 600_000),
    rayleighScattering: times(EARTH_RAYLEIGH, 0.3),
    rayleighScaleHeight: 59_500,
    mieScattering: [1.0e-5, 1.0e-5, 1.0e-5],
    mieAbsorption: [1e-6, 4e-6, 1e-5],
    mieScaleHeight: 80_000,
    mieG: 0.6,
    layer: null,
  },

  // Methane absorbs red light: a deep layer tints the whole atmosphere cyan.
  uranus: {
    ...top('uranus', 300_000),
    rayleighScattering: times(EARTH_RAYLEIGH, 1),
    rayleighScaleHeight: 27_700,
    mieScattering: [2e-6, 2e-6, 2e-6],
    mieAbsorption: none,
    mieScaleHeight: 30_000,
    mieG: 0.5,
    layer: { centre: 40_000, halfWidth: 70_000, scattering: none, absorption: [2e-5, 4e-6, 0], g: 0 },
  },

  neptune: {
    ...top('neptune', 300_000),
    rayleighScattering: times(EARTH_RAYLEIGH, 1.2),
    rayleighScaleHeight: 19_700,
    mieScattering: [3e-6, 3e-6, 3e-6],
    mieAbsorption: none,
    mieScaleHeight: 25_000,
    mieG: 0.5,
    layer: { centre: 40_000, halfWidth: 70_000, scattering: none, absorption: [3.5e-5, 6e-6, 0], g: 0 },
  },
};

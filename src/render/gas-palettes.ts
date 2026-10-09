import type { GasPalette } from './body-materials';

/** Cloud-top appearance of the four giants. Colours are sRGB-ish authoring values; storms are fixed in the body-fixed frame. */
export const GAS_PALETTES: Record<string, GasPalette> = {
  jupiter: {
    a: [0.9, 0.8, 0.64],
    b: [0.6, 0.36, 0.22],
    c: [0.97, 0.94, 0.88],
    frequency: 15,
    turbulence: 1.35,
    contrast: 0.95,
    storm: { lat: -22, lon: 20, dLat: 6, dLon: 11, colour: [0.72, 0.28, 0.18] }, // the Great Red Spot
    polar: [0.5, 0.45, 0.4],
    seed: 3.1,
  },
  saturn: {
    a: [0.93, 0.83, 0.62],
    b: [0.78, 0.66, 0.45],
    c: [0.97, 0.92, 0.8],
    frequency: 24,
    turbulence: 0.4,
    contrast: 0.7,
    polar: [0.55, 0.62, 0.62],
    seed: 5.7,
  },
  uranus: {
    a: [0.62, 0.86, 0.9],
    b: [0.54, 0.8, 0.87],
    c: [0.8, 0.94, 0.96],
    frequency: 10,
    turbulence: 0.2,
    contrast: 0.35,
    polar: [0.78, 0.92, 0.94],
    seed: 8.3,
  },
  neptune: {
    a: [0.28, 0.44, 0.92],
    b: [0.17, 0.3, 0.78],
    c: [0.85, 0.9, 1.0],
    frequency: 13,
    turbulence: 0.8,
    contrast: 0.7,
    storm: { lat: -20, lon: 100, dLat: 7, dLon: 12, colour: [0.07, 0.12, 0.42] }, // the Great Dark Spot
    polar: [0.2, 0.34, 0.8],
    seed: 11.9,
  },
};

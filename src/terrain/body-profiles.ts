/**
 * Procedural terrain profiles for the rocky and icy worlds other than Earth and the Moon. Each profile describes a body's
 * relief, crater population, landmark features and surface palette. Pure data: shared by the terrain workers (geometry),
 * the main thread (collision) and the renderer (colours).
 */
import { BODY_BY_ID } from '../data/solar-system';

export type RGB = readonly [number, number, number];

export interface Feature {
  name: string;
  /** Degrees east / north. */
  lon: number;
  lat: number;
  radiusKm: number;
  /** Height change at the centre (m): positive dome/plateau, negative basin. */
  heightM: number;
  shape: 'dome' | 'plateau' | 'bowl';
  /** Optional darkening (tone 0 bright .. 1 dark), accent and ice pulled towards these values at the centre. */
  tone?: number;
  accent?: number;
  ice?: number;
}

export interface CraterField {
  /** Largest generic crater (m); the population falls by about half per class below this. */
  maxDiameter: number;
  /** Probability multiplier that a grid cell holds a crater (0..1). */
  occupancy: number;
  /** Scales crater depth (1 = like the Moon). */
  depthScale: number;
  /** Fraction of craters that are young and bright. */
  freshFraction: number;
  /** Craters have dark floors (calderas, paterae). */
  darkFloors?: boolean;
}

export interface BodyPalette {
  /** Main surface, dark patches, bright fresh material / accent patches, bright ice. Linear-ish sRGB 0..1. */
  base: RGB;
  dark: RGB;
  fresh: RGB;
  ice: RGB;
  /** 0..1: how strongly the tone field darkens the surface. */
  toneStrength: number;
}

export interface BodyProfile {
  id: string;
  seed: number;
  maxHeight: number;
  relief: { amplitude: number; wavelength: number; gain: number };
  ridges?: { amplitude: number; wavelength: number };
  /** Hemispheric dichotomy (Mars): terrain within `halfAngle` of this point is lowered by `drop`. */
  dichotomy?: { lon: number; lat: number; drop: number };
  craters?: CraterField;
  features: Feature[];
  /** Albedo mottling field. */
  tone: { wavelength: number; contrast: number; bias: number };
  /** Polar caps: ice fades in between these absolute latitudes (degrees). */
  polarCaps?: { from: number; to: number };
  /** Europa-style dark lines: tone is raised along ridged-noise lineae. */
  lineae?: { wavelength: number; strength: number };
  /** Titan-style equatorial dark dune belt (absolute latitude limit in degrees). */
  duneBelt?: number;
  palette: BodyPalette;
}

const feature = (name: string, lon: number, lat: number, radiusKm: number, heightM: number, shape: Feature['shape'], extra: Partial<Feature> = {}): Feature => ({ name, lon, lat, radiusKm, heightM, shape, ...extra });

export const BODY_PROFILES: Record<string, BodyProfile> = {
  mercury: {
    id: 'mercury', seed: 31, maxHeight: 7000,
    relief: { amplitude: 1800, wavelength: 1_500_000, gain: 0.6 },
    craters: { maxDiameter: 350_000, occupancy: 0.55, depthScale: 1, freshFraction: 0.07 },
    features: [feature('Caloris Planitia', 189.8, 30.5, 775, -1500, 'bowl', { tone: 0.15 })],
    tone: { wavelength: 700_000, contrast: 0.35, bias: 0.35 },
    palette: { base: [0.5, 0.47, 0.45], dark: [0.28, 0.26, 0.25], fresh: [0.75, 0.73, 0.7], ice: [0.9, 0.9, 0.9], toneStrength: 0.7 },
  },
  venus: {
    id: 'venus', seed: 41, maxHeight: 14_000,
    relief: { amplitude: 1500, wavelength: 1_200_000, gain: 0.6 },
    ridges: { amplitude: 900, wavelength: 80_000 },
    craters: { maxDiameter: 100_000, occupancy: 0.05, depthScale: 0.6, freshFraction: 0.1 },
    features: [
      feature('Maxwell Montes', 3, 65.2, 400, 9000, 'dome'),
      feature('Ishtar Terra', 25, 70, 1300, 3000, 'plateau'),
      feature('Aphrodite Terra', 100, -8, 1500, 2500, 'plateau'),
      feature('Beta Regio', -78, 25, 600, 4000, 'dome'),
    ],
    tone: { wavelength: 900_000, contrast: 0.3, bias: 0.4 },
    palette: { base: [0.38, 0.27, 0.18], dark: [0.2, 0.15, 0.11], fresh: [0.6, 0.5, 0.35], ice: [0.8, 0.75, 0.6], toneStrength: 0.6 },
  },
  mars: {
    id: 'mars', seed: 51, maxHeight: 24_000,
    relief: { amplitude: 2500, wavelength: 2_000_000, gain: 0.58 },
    ridges: { amplitude: 500, wavelength: 120_000 },
    dichotomy: { lon: 0, lat: 62, drop: 4000 },
    craters: { maxDiameter: 420_000, occupancy: 0.4, depthScale: 0.6, freshFraction: 0.05 },
    features: [
      feature('Olympus Mons', -133.8, 18.65, 300, 21_000, 'dome'),
      feature('Tharsis', -105, 0, 1800, 6500, 'plateau'),
      feature('Ascraeus Mons', -104.5, 11.8, 150, 10_000, 'dome'),
      feature('Pavonis Mons', -112.8, 0.8, 150, 9000, 'dome'),
      feature('Arsia Mons', -120.1, -8.3, 160, 10_000, 'dome'),
      feature('Valles Marineris a', -85, -12, 240, -5000, 'bowl'),
      feature('Valles Marineris b', -75, -13, 240, -5500, 'bowl'),
      feature('Valles Marineris c', -65, -13, 240, -5000, 'bowl'),
      feature('Valles Marineris d', -57, -12, 240, -4000, 'bowl'),
      feature('Hellas Planitia', 70, -42, 1100, -7000, 'bowl', { tone: 0.2 }),
      feature('Argyre Planitia', -43, -50, 400, -3000, 'bowl'),
      feature('Syrtis Major', 69, 9, 600, 0, 'plateau', { tone: 0.95 }),
    ],
    tone: { wavelength: 1_200_000, contrast: 0.7, bias: 0.3 },
    polarCaps: { from: 80, to: 85 },
    palette: { base: [0.62, 0.34, 0.2], dark: [0.22, 0.14, 0.1], fresh: [0.78, 0.55, 0.38], ice: [0.95, 0.95, 0.97], toneStrength: 0.8 },
  },
  phobos: {
    id: 'phobos', seed: 61, maxHeight: 3000,
    relief: { amplitude: 1500, wavelength: 20_000, gain: 0.6 },
    craters: { maxDiameter: 5000, occupancy: 0.5, depthScale: 1, freshFraction: 0.05 },
    features: [feature('Stickney', 49, 1, 4.5, -1800, 'bowl')],
    tone: { wavelength: 12_000, contrast: 0.4, bias: 0.4 },
    palette: { base: [0.28, 0.26, 0.25], dark: [0.15, 0.14, 0.13], fresh: [0.45, 0.42, 0.4], ice: [0.6, 0.6, 0.6], toneStrength: 0.6 },
  },
  deimos: {
    id: 'deimos', seed: 71, maxHeight: 800,
    relief: { amplitude: 400, wavelength: 12_000, gain: 0.5 },
    craters: { maxDiameter: 2500, occupancy: 0.25, depthScale: 0.6, freshFraction: 0.03 },
    features: [],
    tone: { wavelength: 8000, contrast: 0.25, bias: 0.4 },
    palette: { base: [0.32, 0.3, 0.28], dark: [0.2, 0.18, 0.17], fresh: [0.46, 0.43, 0.4], ice: [0.6, 0.6, 0.6], toneStrength: 0.4 },
  },
  io: {
    id: 'io', seed: 81, maxHeight: 20_000,
    relief: { amplitude: 2200, wavelength: 800_000, gain: 0.6 },
    ridges: { amplitude: 1800, wavelength: 150_000 },
    craters: { maxDiameter: 250_000, occupancy: 0.2, depthScale: 0.35, freshFraction: 0.45, darkFloors: true },
    features: [feature('Boösaule Montes', 270, -10, 140, 14_000, 'dome'), feature('Tvashtar', 120, 62, 60, -1500, 'bowl', { tone: 1 })],
    tone: { wavelength: 500_000, contrast: 0.6, bias: 0.35 },
    palette: { base: [0.8, 0.7, 0.3], dark: [0.12, 0.1, 0.08], fresh: [0.85, 0.38, 0.16], ice: [0.95, 0.95, 0.88], toneStrength: 0.85 },
  },
  europa: {
    id: 'europa', seed: 91, maxHeight: 2500,
    relief: { amplitude: 300, wavelength: 1_000_000, gain: 0.55 },
    craters: { maxDiameter: 40_000, occupancy: 0.04, depthScale: 0.4, freshFraction: 0.5 },
    features: [],
    tone: { wavelength: 600_000, contrast: 0.3, bias: 0.15 },
    lineae: { wavelength: 90_000, strength: 0.8 },
    palette: { base: [0.82, 0.78, 0.7], dark: [0.42, 0.28, 0.2], fresh: [0.95, 0.95, 0.95], ice: [0.95, 0.95, 0.95], toneStrength: 0.85 },
  },
  ganymede: {
    id: 'ganymede', seed: 101, maxHeight: 5000,
    relief: { amplitude: 1200, wavelength: 1_500_000, gain: 0.6 },
    ridges: { amplitude: 400, wavelength: 20_000 },
    craters: { maxDiameter: 250_000, occupancy: 0.35, depthScale: 0.5, freshFraction: 0.3 },
    features: [],
    tone: { wavelength: 600_000, contrast: 0.85, bias: 0.4 },
    palette: { base: [0.62, 0.59, 0.54], dark: [0.28, 0.26, 0.24], fresh: [0.9, 0.9, 0.88], ice: [0.9, 0.9, 0.9], toneStrength: 0.85 },
  },
  callisto: {
    id: 'callisto', seed: 111, maxHeight: 6000,
    relief: { amplitude: 1500, wavelength: 1_500_000, gain: 0.6 },
    craters: { maxDiameter: 300_000, occupancy: 0.7, depthScale: 0.8, freshFraction: 0.14 },
    features: [feature('Valhalla', -56, 15, 800, -1000, 'bowl', { tone: 0.2 })],
    tone: { wavelength: 800_000, contrast: 0.25, bias: 0.55 },
    palette: { base: [0.26, 0.24, 0.22], dark: [0.14, 0.13, 0.12], fresh: [0.8, 0.8, 0.78], ice: [0.9, 0.9, 0.9], toneStrength: 0.5 },
  },
  titan: {
    id: 'titan', seed: 121, maxHeight: 3000,
    relief: { amplitude: 600, wavelength: 1_500_000, gain: 0.55 },
    ridges: { amplitude: 200, wavelength: 40_000 },
    craters: { maxDiameter: 100_000, occupancy: 0.04, depthScale: 0.4, freshFraction: 0.2 },
    features: [feature('Xanadu', 100, -10, 1300, 800, 'plateau', { tone: 0.1 })],
    tone: { wavelength: 700_000, contrast: 0.4, bias: 0.4 },
    duneBelt: 30,
    palette: { base: [0.5, 0.34, 0.18], dark: [0.1, 0.07, 0.04], fresh: [0.68, 0.52, 0.32], ice: [0.8, 0.75, 0.65], toneStrength: 0.9 },
  },
  pluto: {
    id: 'pluto', seed: 131, maxHeight: 8000,
    relief: { amplitude: 1800, wavelength: 1_200_000, gain: 0.6 },
    craters: { maxDiameter: 250_000, occupancy: 0.25, depthScale: 0.6, freshFraction: 0.15 },
    features: [
      feature('Sputnik Planitia', 178, 25, 500, -3000, 'bowl', { tone: 0, ice: 1 }),
      feature('Tombaugh Regio', 175, 20, 900, 0, 'plateau', { tone: 0.05, ice: 0.85 }),
      feature('Cthulhu Macula', 90, -10, 1500, 0, 'plateau', { tone: 1 }),
    ],
    tone: { wavelength: 700_000, contrast: 0.45, bias: 0.4 },
    polarCaps: { from: 65, to: 85 },
    palette: { base: [0.62, 0.48, 0.38], dark: [0.3, 0.14, 0.09], fresh: [0.8, 0.7, 0.6], ice: [0.95, 0.9, 0.84], toneStrength: 0.85 },
  },
};

/** Finest-cell level for a body: ~0.5 m cells with 64-cell chunks. */
export function maxLevelFor(radius: number): number {
  return Math.ceil(Math.log2((radius * Math.PI * 0.5) / 64 / 0.5));
}

export const profileRadius = (id: string): number => BODY_BY_ID.get(id)!.radius;

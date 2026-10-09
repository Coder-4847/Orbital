/**
 * The solar system catalogue: physical and orbital data for every body, in one place.
 *
 * Sources: JPL "Keplerian Elements for Approximate Positions of the Major Planets" (Standish, valid 1800-2050) for the
 * planets; IAU WGCCRE pole/rotation constants; JPL/NASA fact sheets for GM and radii; mean elements for the Moon.
 * Moons other than Earth's Moon use mean Keplerian elements (correct period, size, shape and plane; their phase at a
 * given date is not ephemeris-exact). Planet and Moon positions are good to a small fraction of a degree.
 */

export const AU = 1.495978707e11;
export const J2000_JD = 2451545.0;

export type BodyKind = 'star' | 'planet' | 'dwarf' | 'moon';

/** [value at J2000, rate per Julian century] */
type Pair = readonly [number, number];

export type OrbitSpec =
  /** JPL approximate elements (a in AU, angles in degrees, rates per century) around the Sun, ecliptic J2000. */
  | { type: 'standish'; a: Pair; e: Pair; I: Pair; L: Pair; varpi: Pair; Omega: Pair }
  /** Earth's Moon: mean elements with regressing node and advancing perigee, around Earth, ecliptic frame. */
  | { type: 'lunar' }
  /** Mean Keplerian elements (degrees, metres) in the ecliptic or the parent's equatorial plane. */
  | { type: 'kepler'; frame: 'ecliptic' | 'equator'; a: number; e: number; i: number; node: number; peri: number; M0: number };

export interface RotationDef {
  /** IAU pole right ascension / declination (degrees, ICRF) and prime meridian angle at J2000 and its rate (degrees/day). */
  ra: number;
  dec: number;
  w0: number;
  wdot: number;
}

export interface RingDef {
  /** Radii (m) of the visible ring system. */
  inner: number;
  outer: number;
}

export interface BodyDef {
  id: string;
  name: string;
  kind: BodyKind;
  parent: string | null;
  /** Gravitational parameter G*M (m^3/s^2). */
  gm: number;
  /** Mean radius (m). */
  radius: number;
  rotation: RotationDef;
  orbit: OrbitSpec | null;
  /** Geometric albedo (for brightness of unresolved bodies) and a mean sRGB colour (map markers, distant dots). */
  albedo: number;
  color: readonly [number, number, number];
  /** Key into the atmosphere table (data/atmospheres.ts). */
  atmosphere?: string;
  /** How the body is rendered: procedural terrain profile id, a banded gas giant, or the Sun. */
  render: 'terrain' | 'gas' | 'sun';
  rings?: RingDef;
}

const standish = (a: Pair, e: Pair, I: Pair, L: Pair, varpi: Pair, Omega: Pair): OrbitSpec => ({ type: 'standish', a, e, I, L, varpi, Omega });
const moon = (frame: 'ecliptic' | 'equator', a: number, e: number, i: number, node: number, peri: number, M0: number): OrbitSpec => ({ type: 'kepler', frame, a, e, i, node, peri, M0 });

export const BODIES: readonly BodyDef[] = [
  {
    id: 'sun', name: 'Sun', kind: 'star', parent: null, gm: 1.32712440018e20, radius: 6.957e8,
    rotation: { ra: 286.13, dec: 63.87, w0: 84.176, wdot: 14.1844 }, orbit: null, albedo: 0, color: [1, 0.95, 0.8], render: 'sun',
  },
  {
    id: 'mercury', name: 'Mercury', kind: 'planet', parent: 'sun', gm: 2.2032e13, radius: 2.4397e6,
    rotation: { ra: 281.0103, dec: 61.4155, w0: 329.5988, wdot: 6.1385108 },
    orbit: standish([0.38709927, 0.00000037], [0.20563593, 0.00001906], [7.00497902, -0.00594749], [252.2503235, 149472.67411175], [77.45779628, 0.16047689], [48.33076593, -0.12534081]),
    albedo: 0.14, color: [0.55, 0.52, 0.5], render: 'terrain',
  },
  {
    id: 'venus', name: 'Venus', kind: 'planet', parent: 'sun', gm: 3.24859e14, radius: 6.0518e6,
    rotation: { ra: 272.76, dec: 67.16, w0: 160.2, wdot: -1.4813688 },
    orbit: standish([0.72333566, 0.0000039], [0.00677672, -0.00004107], [3.39467605, -0.0007889], [181.9790995, 58517.81538729], [131.60246718, 0.00268329], [76.67984255, -0.27769418]),
    albedo: 0.75, color: [0.9, 0.8, 0.55], atmosphere: 'venus', render: 'terrain',
  },
  {
    id: 'earth', name: 'Earth', kind: 'planet', parent: 'sun', gm: 3.986004418e14, radius: 6.371e6,
    rotation: { ra: 0, dec: 90, w0: 190.147, wdot: 360.9856235 },
    // Earth-Moon barycentre elements; Earth itself is offset from this by the Moon's pull (see ephemeris).
    orbit: standish([1.00000261, 0.00000562], [0.01671123, -0.00004392], [-0.00001531, -0.01294668], [100.46457166, 35999.37244981], [102.93768193, 0.32327364], [0, 0]),
    albedo: 0.3, color: [0.2, 0.4, 0.8], atmosphere: 'earth', render: 'terrain',
  },
  {
    id: 'moon', name: 'Moon', kind: 'moon', parent: 'earth', gm: 4.9048695e12, radius: 1.7374e6,
    rotation: { ra: 269.9949, dec: 66.5392, w0: 38.3213, wdot: 13.17635815 }, orbit: { type: 'lunar' },
    albedo: 0.12, color: [0.6, 0.6, 0.58], render: 'terrain',
  },
  {
    id: 'mars', name: 'Mars', kind: 'planet', parent: 'sun', gm: 4.282837e13, radius: 3.3895e6,
    rotation: { ra: 317.68143, dec: 52.8865, w0: 176.63, wdot: 350.89198226 },
    orbit: standish([1.52371034, 0.00001847], [0.0933941, 0.00007882], [1.84969142, -0.00813131], [-4.55343205, 19140.30268499], [-23.94362959, 0.44441088], [49.55953891, -0.29257343]),
    albedo: 0.25, color: [0.75, 0.4, 0.25], atmosphere: 'mars', render: 'terrain',
  },
  {
    id: 'phobos', name: 'Phobos', kind: 'moon', parent: 'mars', gm: 7.087e5, radius: 1.11e4,
    rotation: { ra: 317.68, dec: 52.9, w0: 35.06, wdot: 1128.844585 }, orbit: moon('equator', 9.376e6, 0.0151, 1.09, 49, 150, 190),
    albedo: 0.07, color: [0.4, 0.38, 0.36], render: 'terrain',
  },
  {
    id: 'deimos', name: 'Deimos', kind: 'moon', parent: 'mars', gm: 9.62e4, radius: 6.2e3,
    rotation: { ra: 316.65, dec: 53.52, w0: 79.41, wdot: 285.161897 }, orbit: moon('equator', 2.34632e7, 0.0002, 1.79, 200, 10, 40),
    albedo: 0.08, color: [0.45, 0.42, 0.4], render: 'terrain',
  },
  {
    id: 'jupiter', name: 'Jupiter', kind: 'planet', parent: 'sun', gm: 1.26686534e17, radius: 6.9911e7,
    rotation: { ra: 268.056595, dec: 64.495303, w0: 284.95, wdot: 870.536642 },
    orbit: standish([5.202887, -0.00011607], [0.04838624, -0.00013253], [1.30439695, -0.00183714], [34.39644051, 3034.74612775], [14.72847983, 0.21252668], [100.47390909, 0.20469106]),
    albedo: 0.5, color: [0.85, 0.75, 0.6], atmosphere: 'jupiter', render: 'gas',
  },
  {
    id: 'io', name: 'Io', kind: 'moon', parent: 'jupiter', gm: 5.959916e12, radius: 1.8216e6,
    rotation: { ra: 268.05, dec: 64.5, w0: 200.39, wdot: 203.4889538 }, orbit: moon('equator', 4.218e8, 0.0041, 0.04, 0, 0, 106.0772),
    albedo: 0.63, color: [0.9, 0.8, 0.4], render: 'terrain',
  },
  {
    id: 'europa', name: 'Europa', kind: 'moon', parent: 'jupiter', gm: 3.202739e12, radius: 1.5608e6,
    rotation: { ra: 268.08, dec: 64.51, w0: 36.022, wdot: 101.3747235 }, orbit: moon('equator', 6.711e8, 0.0094, 0.47, 0, 0, 175.7316),
    albedo: 0.67, color: [0.85, 0.8, 0.7], render: 'terrain',
  },
  {
    id: 'ganymede', name: 'Ganymede', kind: 'moon', parent: 'jupiter', gm: 9.887834e12, radius: 2.6341e6,
    rotation: { ra: 268.2, dec: 64.57, w0: 44.064, wdot: 50.3176081 }, orbit: moon('equator', 1.0704e9, 0.0013, 0.18, 0, 0, 120.5588),
    albedo: 0.43, color: [0.6, 0.57, 0.52], render: 'terrain',
  },
  {
    id: 'callisto', name: 'Callisto', kind: 'moon', parent: 'jupiter', gm: 7.179289e12, radius: 2.4103e6,
    rotation: { ra: 268.72, dec: 64.83, w0: 259.51, wdot: 21.5710715 }, orbit: moon('equator', 1.8827e9, 0.0074, 0.19, 0, 0, 84.4446),
    albedo: 0.17, color: [0.35, 0.33, 0.3], render: 'terrain',
  },
  {
    id: 'saturn', name: 'Saturn', kind: 'planet', parent: 'sun', gm: 3.7931187e16, radius: 5.8232e7,
    rotation: { ra: 40.589, dec: 83.537, w0: 38.9, wdot: 810.7939024 },
    orbit: standish([9.53667594, -0.0012506], [0.05386179, -0.00050991], [2.48599187, 0.00193609], [49.95424423, 1222.49362201], [92.59887831, -0.41897216], [113.66242448, -0.28867794]),
    albedo: 0.47, color: [0.9, 0.82, 0.62], atmosphere: 'saturn', render: 'gas', rings: { inner: 7.4658e7, outer: 1.36775e8 },
  },
  {
    id: 'titan', name: 'Titan', kind: 'moon', parent: 'saturn', gm: 8.978138e12, radius: 2.5747e6,
    rotation: { ra: 36.41, dec: 83.94, w0: 189.64, wdot: 22.5769768 }, orbit: moon('equator', 1.22187e9, 0.0288, 0.35, 0, 180, 100),
    albedo: 0.22, color: [0.85, 0.6, 0.25], atmosphere: 'titan', render: 'terrain',
  },
  {
    id: 'uranus', name: 'Uranus', kind: 'planet', parent: 'sun', gm: 5.793939e15, radius: 2.5362e7,
    rotation: { ra: 257.311, dec: -15.175, w0: 203.81, wdot: -501.1600928 },
    orbit: standish([19.18916464, -0.00196176], [0.04725744, -0.00004397], [0.77263783, -0.00242939], [313.23810451, 428.48202785], [170.9542763, 0.40805281], [74.01692503, 0.04240589]),
    albedo: 0.51, color: [0.6, 0.85, 0.9], atmosphere: 'uranus', render: 'gas',
  },
  {
    id: 'neptune', name: 'Neptune', kind: 'planet', parent: 'sun', gm: 6.836529e15, radius: 2.4622e7,
    rotation: { ra: 299.36, dec: 43.46, w0: 249.978, wdot: 541.1397757 },
    orbit: standish([30.06992276, 0.00026291], [0.00859048, 0.00005105], [1.77004347, 0.00035372], [-55.12002969, 218.45945325], [44.96476227, -0.32241464], [131.78422574, -0.00508664]),
    albedo: 0.41, color: [0.3, 0.45, 0.95], atmosphere: 'neptune', render: 'gas',
  },
  {
    id: 'pluto', name: 'Pluto', kind: 'dwarf', parent: 'sun', gm: 8.696e11, radius: 1.1883e6,
    rotation: { ra: 132.993, dec: -6.163, w0: 302.695, wdot: 56.3625225 },
    orbit: standish([39.48211675, -0.00031596], [0.2488273, 0.0000517], [17.14001206, 0.00004818], [238.92903833, 145.20780515], [224.06891629, -0.04062942], [110.30393684, -0.01183482]),
    albedo: 0.52, color: [0.8, 0.7, 0.6], render: 'terrain',
  },
];

export const BODY_BY_ID: ReadonlyMap<string, BodyDef> = new Map(BODIES.map((b) => [b.id, b]));

export const bodyDef = (id: string): BodyDef => {
  const def = BODY_BY_ID.get(id);
  if (!def) throw new Error(`Unknown body "${id}"`);
  return def;
};

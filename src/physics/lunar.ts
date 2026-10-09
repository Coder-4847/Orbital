/**
 * Periodic perturbations of the Moon's ecliptic longitude beyond its Kepler ellipse (Meeus, Astronomical Algorithms ch. 47,
 * main terms). The Sun's pull on the orbit is the largest: evection (1.27 deg), variation (0.66 deg), the annual equation
 * (0.19 deg) and a dozen smaller ones. Without them the mean orbit is off by up to ~2 degrees (13,000 km), enough to
 * make a real eclipse miss the Earth. The elliptical equation of centre (6.29 deg) and the reduction to the ecliptic are
 * left out here because the Kepler propagation already produces them.
 * Pure maths: no rendering imports.
 */
const DEG = Math.PI / 180;
const DAY = 86400;

/** Mean arguments (degrees at J2000, degrees per day): elongation D, Sun anomaly M, Moon anomaly M'. */
const D0 = 297.8502;
const D1 = 12.19074912;
const M0 = 357.5291;
const M1 = 0.98560028;
const MP0 = 134.9634;
const MP1 = 13.06499191;

/** Coefficient (degrees) and multiples of [D, M, M']. */
const TERMS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1.274027, 2, 0, -1], // evection
  [0.658314, 2, 0, 0], // variation
  [-0.185116, 0, 1, 0], // annual equation
  [0.058793, 2, 0, -2],
  [0.057066, 2, -1, -1],
  [0.053322, 2, 0, 1],
  [0.045758, 2, -1, 0],
  [-0.040923, 0, 1, -1],
  [-0.03472, 1, 0, 0], // parallactic equation
  [-0.030383, 0, 1, 1],
  [0.010675, 4, 0, -1],
  [0.008548, 4, 0, -2],
  [-0.007888, 2, 1, -1],
];

/** Longitude correction (rad) and its rate (rad/s) at `ut` seconds since J2000. */
export function lunarLongitudePerturbation(ut: number): { dL: number; rate: number } {
  const d = ut / DAY;
  const D = (D0 + D1 * d) * DEG;
  const M = (M0 + M1 * d) * DEG;
  const MP = (MP0 + MP1 * d) * DEG;
  let dL = 0;
  let rate = 0;
  for (const [amp, kd, km, kmp] of TERMS) {
    const arg = kd * D + km * M + kmp * MP;
    const argRate = (kd * D1 + km * M1 + kmp * MP1) * DEG; // rad/day
    dL += amp * Math.sin(arg);
    rate += amp * Math.cos(arg) * argRate;
  }
  return { dL: dL * DEG, rate: (rate * DEG) / DAY };
}

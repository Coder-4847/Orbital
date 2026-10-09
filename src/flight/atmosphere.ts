/**
 * Air for the flight physics. Earth follows the US Standard Atmosphere 1976 up to 86 km (piecewise temperature lapse, hydrostatic
 * pressure), then thins exponentially. Other worlds with air use an exponential model from their surface pressure and scale
 * height (enough for drag, parachutes and entry). Pure maths.
 */
export interface AirState {
  /** Pascals. */
  pressure: number;
  /** kg/m^3. */
  density: number;
  /** Kelvin. */
  temperature: number;
}

export type AirModel = (altitude: number) => AirState;

const G0 = 9.80665;
const R_AIR = 287.053;
const GAMMA = 1.4;
export const SEA_LEVEL_PRESSURE = 101325;

// Base altitude (m), base temperature (K), lapse rate (K/m) of the standard layers up to 86 km.
const LAYERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 288.15, -0.0065],
  [11_000, 216.65, 0],
  [20_000, 216.65, 0.001],
  [32_000, 228.65, 0.0028],
  [47_000, 270.65, 0],
  [51_000, 270.65, -0.0028],
  [71_000, 214.65, -0.002],
];
const TOP = 86_000;

/** Pressure at the base of each layer, built once. */
const BASE_PRESSURE: number[] = (() => {
  const out = [SEA_LEVEL_PRESSURE];
  for (let i = 0; i < LAYERS.length - 1; i++) {
    const [h0, t0, L] = LAYERS[i]!;
    const h1 = LAYERS[i + 1]![0];
    const p0 = out[i]!;
    out.push(L === 0 ? p0 * Math.exp((-G0 * (h1 - h0)) / (R_AIR * t0)) : p0 * Math.pow((t0 + L * (h1 - h0)) / t0, -G0 / (R_AIR * L)));
  }
  return out;
})();

function standard(h: number): AirState {
  let i = LAYERS.length - 1;
  while (i > 0 && h < LAYERS[i]![0]) i--;
  const [h0, t0, L] = LAYERS[i]!;
  const dh = h - h0;
  const T = t0 + L * dh;
  const p0 = BASE_PRESSURE[i]!;
  const p = L === 0 ? p0 * Math.exp((-G0 * dh) / (R_AIR * t0)) : p0 * Math.pow(T / t0, -G0 / (R_AIR * L));
  return { pressure: p, density: p / (R_AIR * T), temperature: T };
}

/** Earth's atmosphere at geometric altitude `h` metres above sea level. */
export function earthAir(h: number): AirState {
  if (h <= 0) return standard(0);
  if (h <= TOP) return standard(h);
  const top = standard(TOP);
  const scale = (R_AIR * top.temperature) / G0; // ~ 5 km; thins faster than real upper air, which is nothing to drag at 7.8 km/s
  const k = Math.exp(-(h - TOP) / (scale * 1.6));
  return { pressure: top.pressure * k, density: top.density * k, temperature: top.temperature };
}

/** An exponential atmosphere defined by surface pressure (Pa), scale height (m) and temperature (K). */
export function exponentialAir(surfacePressure: number, scaleHeight: number, temperature: number): AirModel {
  return (h) => {
    const k = Math.exp(-h / scaleHeight); // below the reference level (gas giants) the pressure keeps climbing
    const p = surfacePressure * k;
    return { pressure: p, density: p / (R_AIR * temperature), temperature };
  };
}

export const speedOfSound = (temperature: number): number => Math.sqrt(GAMMA * R_AIR * temperature);

/**
 * Drag-coefficient multiplier against Mach number: the transonic rise peaking just above Mach 1, then a slow fall
 * towards the hypersonic value.
 */
export function machDragFactor(mach: number): number {
  const rise = 1 + 0.9 * Math.exp(-(((mach - 1.1) / 0.32) ** 2)) + (mach > 1.1 ? 0.25 * (1 - Math.exp(-(mach - 1.1))) : 0);
  const fall = mach > 2 ? 0.45 * (1 - Math.exp(-(mach - 2) / 2.5)) : 0;
  return Math.max(0.6, rise - fall);
}

/** Dynamic pressure (Pa). */
export const dynamicPressure = (density: number, speed: number): number => 0.5 * density * speed * speed;

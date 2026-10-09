/** Distance and speed formatting for the metric / imperial setting. Pure. */
export type Units = 'metric' | 'imperial';

const FT = 3.280839895;
const MILE = 1609.344;
const AU = 1.495978707e11;

/** Distances: metres and kilometres (then Mm and Gm), or feet and miles. */
export function formatLength(m: number, units: Units = 'metric'): string {
  const a = Math.abs(m);
  if (a >= 1e11) return `${(m / AU).toFixed(3)} AU`;
  if (units === 'metric') {
    if (a >= 1e9) return `${(m / 1e9).toFixed(2)} Gm`;
    if (a >= 1e6) return `${(m / 1e6).toFixed(2)} Mm`;
    if (a >= 1e4) return `${(m / 1e3).toFixed(1)} km`;
    if (a >= 1e3) return `${(m / 1e3).toFixed(2)} km`;
    return `${m.toFixed(1)} m`;
  }
  const mi = m / MILE;
  if (Math.abs(mi) >= 1e6) return `${(mi / 1e6).toFixed(2)} M mi`;
  if (Math.abs(mi) >= 100) return `${Math.round(mi).toLocaleString('en-US')} mi`;
  if (Math.abs(mi) >= 2) return `${mi.toFixed(1)} mi`;
  const ft = m * FT;
  return Math.abs(ft) >= 1000 ? `${(ft / 1000).toFixed(2)}k ft` : `${ft.toFixed(0)} ft`;
}

/** Speeds: m/s up to 1 km/s then km/s, or ft/s then mi/s. */
export function formatSpeed(ms: number, units: Units = 'metric'): string {
  const a = Math.abs(ms);
  if (units === 'metric') return a < 1000 ? `${ms.toFixed(a < 100 ? 1 : 0)} m/s` : `${(ms / 1000).toFixed(2)} km/s`;
  const fps = ms * FT;
  return a < 1000 ? `${fps.toFixed(Math.abs(fps) < 100 ? 1 : 0)} ft/s` : `${(ms / MILE).toFixed(2)} mi/s`;
}

/** Delta-v as used in maneuver readouts. */
export const formatDeltaV = (ms: number, units: Units = 'metric'): string => formatSpeed(ms, units);

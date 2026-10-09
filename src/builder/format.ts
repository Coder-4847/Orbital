/** Number formatting for the builder's readouts (pure). */

/** Mass in kg below 10 t, otherwise tonnes. */
export function fmtMass(kg: number): string {
  if (kg >= 100_000) return `${(kg / 1000).toFixed(0)} t`;
  if (kg >= 10_000) return `${(kg / 1000).toFixed(1)} t`;
  return `${Math.round(kg).toLocaleString('en-US')} kg`;
}

export function fmtThrust(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MN`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)} kN`;
  return `${n.toFixed(0)} N`;
}

export const fmtDv = (v: number): string => `${Math.round(v).toLocaleString('en-US')} m/s`;

export function fmtDuration(s: number): string {
  if (!(s > 0)) return '—';
  if (s < 90) return `${s.toFixed(0)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return m < 120 ? `${m}m ${String(r).padStart(2, '0')}s` : `${(s / 3600).toFixed(1)} h`;
}

export const fmtTwr = (t: number): string => (t > 0 ? t.toFixed(2) : '—');

export const fmtLength = (m: number): string => `${m.toFixed(m >= 10 ? 1 : 2)} m`;

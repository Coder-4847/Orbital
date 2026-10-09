/** Universal time (UT) is seconds since J2000 (2000-01-01T12:00:00 UTC); the simulation clock and saves use it. */
export const J2000_EPOCH_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

export function universalTimeToDate(ut: number): Date {
  return new Date(J2000_EPOCH_MS + ut * 1000);
}

export function dateToUniversalTime(date: Date): number {
  return (date.getTime() - J2000_EPOCH_MS) / 1000;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** "2031-04-02 18:30 UTC" */
export function formatUniversalTime(ut: number): string {
  const d = universalTimeToDate(ut);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** Short "time ago" for save lists. */
export function timeAgo(thenMs: number, nowMs = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d} d ago` : new Date(thenMs).toLocaleDateString();
}

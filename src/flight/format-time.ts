/** Durations for the map and the maneuver panel: "2d 04h", "3h 12m", "12m 05s", "34 s". Pure. */
export function fmtCountdown(seconds: number): string {
  const s = Math.max(0, seconds);
  if (!Number.isFinite(s)) return '—';
  if (s < 90) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  if (s < 3600) return `${m}m ${String(Math.round(s - m * 60)).padStart(2, '0')}s`;
  const hours = Math.floor(s / 3600);
  if (s < 86_400) return `${hours}h ${String(Math.floor((s - hours * 3600) / 60)).padStart(2, '0')}m`;
  const days = Math.floor(s / 86_400);
  if (days < 400) return `${days}d ${String(Math.floor((s - days * 86_400) / 3600)).padStart(2, '0')}h`;
  return `${(s / 31_557_600).toFixed(2)} yr`;
}

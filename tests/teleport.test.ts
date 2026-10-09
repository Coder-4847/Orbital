import { describe, expect, it } from 'vitest';
import { litTimeAt, solarTimeAt, subsolarPoint } from '../src/flight/teleport';

const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const ut = (iso: string) => (Date.parse(iso) - J2000_MS) / 1000;
const wrap180 = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;

describe('solar time helpers', () => {
  it('solarTimeAt finds the time when the Sun is overhead / at a given hour on Earth', () => {
    for (const [lon, hour] of [[10, 12], [-120, 15.5], [80, 6.25], [0, 0]] as const) {
      const t = solarTimeAt(ut('2026-06-21T00:00:00Z'), lon, hour);
      expect(Math.abs(wrap180(subsolarPoint('earth', t).lon - (lon - (hour - 12) * 15)))).toBeLessThan(0.02);
      expect(Math.abs(t - ut('2026-06-21T00:00:00Z'))).toBeLessThan(86400 * 1.01);
    }
  });

  it('the subsolar latitude on the June solstice is about +23.4 degrees', () => {
    expect(subsolarPoint('earth', ut('2026-06-21T12:00:00Z')).lat).toBeGreaterThan(23);
    expect(subsolarPoint('earth', ut('2026-12-21T12:00:00Z')).lat).toBeLessThan(-23);
  });

  it('works for slowly rotating bodies: noon on Mars and on Venus', () => {
    const start = ut('2026-10-08T00:00:00Z');
    for (const id of ['mars', 'venus']) {
      const t = solarTimeAt(start, 45, 12, id);
      expect(Math.abs(wrap180(subsolarPoint(id, t).lon - 45))).toBeLessThan(0.05);
    }
  });

  it('litTimeAt finds a time within the lunar day when the Sun is high over Tycho', () => {
    const start = ut('2026-10-08T00:00:00Z');
    const t = litTimeAt('moon', start, -11.4, -43.3, 0.6);
    expect(t).toBeGreaterThanOrEqual(start);
    expect(t - start).toBeLessThan(31 * 86400);
  });
});

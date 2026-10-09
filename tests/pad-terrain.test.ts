import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE, PAD_FLAT_RADIUS } from '../src/data/sites';
import { EarthSource } from '../src/terrain/earth-source';
import { lonLatToDirection } from '../src/terrain/cube-sphere';
import { makeSurfaceSample } from '../src/terrain/types';
import { loadEarthDataForTests } from './helpers/earth-data';

describe('launch pad terrain', () => {
  it('is exactly level and above water within the pad radius, and blends away smoothly', () => {
    const src = new EarthSource(loadEarthDataForTests());
    const out = makeSurfaceSample();
    const at = (dEast: number) => {
      const lon = (DEFAULT_SITE.lon * Math.PI) / 180 + dEast / (6.371e6 * Math.cos((DEFAULT_SITE.lat * Math.PI) / 180));
      const d = lonLatToDirection(lon, (DEFAULT_SITE.lat * Math.PI) / 180, new Float64Array(3));
      src.sample(d[0]!, d[1]!, d[2]!, 0.5, out);
      return out.height;
    };
    for (const e of [0, 50, 150, PAD_FLAT_RADIUS - 20]) expect(at(e)).toBeCloseTo(DEFAULT_SITE.height, 6);
    const mid = at(1200);
    expect(mid).toBeGreaterThanOrEqual(0);
    expect(mid).toBeLessThanOrEqual(DEFAULT_SITE.height + 0.01);
  });
});

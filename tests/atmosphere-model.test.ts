import { describe, expect, it } from 'vitest';
import { EARTH_ATMOSPHERE as A, REFERENCE_KEY_LUMINANCE, distanceToTop, exposureForKey, exposureForSunElevation, horizonMu, keyLuminance, transmittanceToTop } from '../src/render/atmosphere-model';

describe('atmosphere reference maths', () => {
  it('vertical transmittance at sea level: blue is absorbed most, values match known Earth ranges', () => {
    const t = transmittanceToTop(A, A.radius, 1);
    // Rayleigh optical depth at zenith ~0.1 (red) .. ~0.45 (blue); ozone shifts green slightly.
    expect(t[0]).toBeGreaterThan(0.85);
    expect(t[0]).toBeLessThan(0.95);
    expect(t[2]).toBeLessThan(t[1]);
    expect(t[1]).toBeLessThan(t[0]);
    expect(t[2]).toBeGreaterThan(0.55);
  });

  it('sun near the horizon is strongly reddened', () => {
    const t = transmittanceToTop(A, A.radius + 1, 0.02);
    expect(t[0]).toBeGreaterThan(t[1]);
    expect(t[1]).toBeGreaterThan(t[2]);
    expect(t[0] / Math.max(t[2], 1e-6)).toBeGreaterThan(8);
  });

  it('is exactly zero when the sun is well below the horizon (planet shadow) and 1 above the atmosphere', () => {
    expect(transmittanceToTop(A, A.radius + 1, -0.3)).toEqual([0, 0, 0]);
    const space = transmittanceToTop(A, A.topRadius + 1000, 0.3);
    expect(space[0]).toBeCloseTo(1, 3);
  });

  it('from high altitude the horizon dips below the horizontal', () => {
    expect(horizonMu(A, A.radius)).toBe(0);
    expect(horizonMu(A, A.radius + 400_000)).toBeLessThan(-0.3);
    // Sun slightly below the ground horizon is still visible from a mountain-top / aircraft altitude.
    const high = transmittanceToTop(A, A.radius + 10_000, -0.05);
    expect(high[0]).toBeGreaterThan(0);
  });

  it('distanceToTop is the atmosphere thickness straight up', () => {
    expect(distanceToTop(A, A.radius, 1)).toBeCloseTo(80_000, 0);
  });

  it('exposure rises as the sun sets and is clamped', () => {
    const noon = exposureForKey(keyLuminance(A, 1, 0.9));
    const dusk = exposureForKey(keyLuminance(A, 1, 0.02));
    const night = exposureForKey(keyLuminance(A, 1, -0.4));
    expect(noon).toBeCloseTo(1, 0);
    expect(dusk).toBeGreaterThan(noon);
    expect(night).toBeGreaterThan(dusk);
    expect(night).toBeLessThanOrEqual(160);
    expect(keyLuminance(null, 0, 1)).toBeGreaterThan(0);
    expect(REFERENCE_KEY_LUMINANCE).toBeGreaterThan(0.3);
  });

  it('twilight exposure curve is monotonic, continuous, capped and equals 1 at high sun', () => {
    expect(exposureForSunElevation(60)).toBe(1);
    let previous = exposureForSunElevation(40);
    for (let e = 39; e >= -25; e -= 0.5) {
      const x = exposureForSunElevation(e);
      expect(x).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(x / previous).toBeLessThan(1.25); // no jumps between half-degree steps
      previous = x;
    }
    expect(exposureForSunElevation(-40)).toBeLessThanOrEqual(150);
    expect(exposureForSunElevation(0)).toBeGreaterThan(2);
    expect(exposureForSunElevation(0)).toBeLessThan(6);
  });
});

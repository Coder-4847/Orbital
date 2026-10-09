import { describe, expect, it } from 'vitest';
import { adaptExposure, targetExposure, type ExposureInput } from '../src/flight/exposure';

const scaleAt = (au: number) => 1 / (au * au);

const space = (over: Partial<ExposureInput>): ExposureInput => ({
  isStar: false,
  atmosphereHeight: 0,
  bodyRadius: 6.371e6,
  altitude: 6e8,
  sinSun: 1,
  irradianceScale: 1,
  ...over,
});

describe('targetExposure', () => {
  it('is neutral in deep space and near Earth', () => {
    expect(targetExposure(space({ altitude: 5e9 }))).toBeCloseTo(1, 6);
    expect(targetExposure(space({ altitude: 6e5, atmosphereHeight: 1e5 }))).toBeCloseTo(1, 1);
  });

  it('opens up near dim far worlds and closes down near bright ones', () => {
    const saturn = targetExposure(space({ bodyRadius: 6.0268e7, altitude: 1.7e8, atmosphereHeight: 6e5, irradianceScale: scaleAt(9.5) }));
    const mercury = targetExposure(space({ bodyRadius: 2.44e6, altitude: 7e6, irradianceScale: scaleAt(0.39) }));
    expect(saturn).toBeGreaterThan(30);
    expect(mercury).toBeLessThan(0.3);
  });

  it('fades back to neutral far from the world (it only adapts within a couple hundred radii)', () => {
    const near = targetExposure(space({ bodyRadius: 6.0268e7, altitude: 1e9, irradianceScale: scaleAt(9.5) }));
    const far = targetExposure(space({ bodyRadius: 6.0268e7, altitude: 2e10, irradianceScale: scaleAt(9.5) }));
    expect(near).toBeGreaterThan(1.5);
    expect(far).toBeCloseTo(1, 6);
  });

  it('uses a very short exposure when close to the Sun', () => {
    const e = targetExposure(space({ isStar: true, bodyRadius: 6.957e8, altitude: 3e9, irradianceScale: 1e5 }));
    expect(e).toBeLessThan(0.1);
  });

  it('is darker (shorter) at noon than at night on the ground, with air', () => {
    const base = { atmosphereHeight: 1e5, altitude: 20 };
    const noon = targetExposure(space({ ...base, sinSun: 1 }));
    const night = targetExposure(space({ ...base, sinSun: -0.5 }));
    expect(night).toBeGreaterThan(noon * 5);
  });
});

describe('adaptExposure', () => {
  it('snaps straight to the target on request', () => {
    expect(adaptExposure(1, 40, 0.016, true)).toBeCloseTo(40, 9);
  });

  it('closes down faster than it opens up', () => {
    const down = Math.log(1) - Math.log(adaptExposure(1, 0.1, 0.5, false)); // brighter scene: exposure falls
    const up = Math.log(adaptExposure(1, 10, 0.5, false)) - Math.log(1); // darker scene: exposure rises
    expect(down).toBeGreaterThan(up * 3);
    expect(adaptExposure(2, 2, 0.5, false)).toBeCloseTo(2, 9);
  });
});

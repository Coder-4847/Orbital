import { describe, expect, it } from 'vitest';
import { horizonAngle, isBehindHorizon, shouldSplit, TERRAIN_QUALITY } from '../src/terrain/lod';

const R = 6_371_000;

describe('LOD rules', () => {
  it('splits near nodes and stops at the max level', () => {
    expect(shouldSplit(100, 1000, 5, 19, 6)).toBe(true);
    expect(shouldSplit(7000, 1000, 5, 19, 6)).toBe(false);
    expect(shouldSplit(1, 1000, 19, 19, 6)).toBe(false);
  });

  it('higher quality presets split from further away and keep more chunks', () => {
    for (let i = 1; i < TERRAIN_QUALITY.length; i++) {
      expect(TERRAIN_QUALITY[i]!.splitFactor).toBeGreaterThan(TERRAIN_QUALITY[i - 1]!.splitFactor);
      expect(TERRAIN_QUALITY[i]!.maxChunks).toBeGreaterThan(TERRAIN_QUALITY[i - 1]!.maxChunks);
    }
  });

  it('horizon angle grows with altitude and includes mountain tops', () => {
    const ground = horizonAngle(R, 9000, R + 2);
    const orbit = horizonAngle(R, 9000, R + 400_000);
    expect(orbit).toBeGreaterThan(ground);
    expect(ground).toBeGreaterThan(0.04); // mountains over the geometric horizon even at ground level
    expect(orbit).toBeCloseTo(Math.acos(R / (R + 400_000)) + Math.acos(R / (R + 9000)), 12);
  });

  it('culls nodes on the far side of the planet but keeps those near the horizon', () => {
    const cam = R + 1000;
    // Camera on +X. A node at the antipode is behind the horizon; one straight below is not.
    expect(isBehindHorizon(cam, 0, 0, cam, -1, 0, 0, 0.05, R, 9000)).toBe(true);
    expect(isBehindHorizon(cam, 0, 0, cam, 1, 0, 0, 0.05, R, 9000)).toBe(false);
    // A node 3 degrees along the surface is well inside the horizon of a 1 km high camera... and 30 degrees is not visible.
    const near = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0] as const;
    expect(isBehindHorizon(cam, 0, 0, cam, ...near(2), 0.001, R, 9000)).toBe(false);
    expect(isBehindHorizon(cam, 0, 0, cam, ...near(30), 0.001, R, 9000)).toBe(true);
  });

  it('never culls when the camera is inside the planet radius', () => {
    expect(isBehindHorizon(R - 10, 0, 0, R - 10, -1, 0, 0, 0.01, R, 9000)).toBe(false);
  });
});

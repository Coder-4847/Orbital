import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { CHUNK_CELLS, buildChunk } from '../src/terrain/chunk-builder';
import { EarthSource } from '../src/terrain/earth-source';
import { MoonSource } from '../src/terrain/moon-source';
import { nodeEdgeLength } from '../src/terrain/cube-sphere';
import type { TerrainSource } from '../src/terrain/types';
import { loadEarthDataForTests } from './helpers/earth-data';

const N = CHUNK_CELLS;
const stride = N + 1;

/** Absolute radius of grid vertex (a,b). */
function radiusAt(chunk: ReturnType<typeof buildChunk>, a: number, b: number): number {
  const v = b * stride + a;
  return Math.hypot(chunk.origin[0] + chunk.positions[v * 3]!, chunk.origin[1] + chunk.positions[v * 3 + 1]!, chunk.origin[2] + chunk.positions[v * 3 + 2]!);
}

/**
 * Cracks appear where a fine chunk meets a coarse one (T-junctions): the fine edge follows the true surface while the
 * coarse edge interpolates linearly between its sparser vertices. Skirts must be at least as deep as the worst mismatch.
 */
function worstMismatch(source: TerrainSource, level: number, i: number, j: number): { mismatch: number; skirt: number } {
  const coarse = buildChunk(source, { face: 0, level, i, j });
  // The neighbour on the +s side, one level finer: two chunks stacked along t share the coarse chunk's right edge.
  const fineA = buildChunk(source, { face: 0, level: level + 1, i: 2 * (i + 1), j: 2 * j });
  const fineB = buildChunk(source, { face: 0, level: level + 1, i: 2 * (i + 1), j: 2 * j + 1 });
  let mismatch = 0;
  for (const [fine, half] of [[fineA, 0], [fineB, 1]] as const) {
    for (let b = 0; b <= N; b++) {
      const fineR = radiusAt(fine, 0, b); // left edge of the fine chunk
      // Coarse right-edge position along t, in coarse vertex units.
      const tc = (half * N + b) / 2;
      const b0 = Math.floor(tc);
      const b1 = Math.min(N, b0 + 1);
      const f = tc - b0;
      const coarseR = radiusAt(coarse, N, b0) * (1 - f) + radiusAt(coarse, N, b1) * f;
      mismatch = Math.max(mismatch, Math.abs(fineR - coarseR));
    }
  }
  const spacingCoarse = nodeEdgeLength(source.radius, level) / N;
  return { mismatch, skirt: spacingCoarse * 0.7 + 0.3 };
}

describe('LOD seams are covered by skirts', () => {
  const earth = new EarthSource(loadEarthDataForTests());
  const moon = new MoonSource();

  it('Earth: rough mountain terrain at several levels', () => {
    for (const [level, i, j] of [[8, 150, 128], [10, 600, 530], [12, 2400, 2110], [14, 9600, 8400]] as const) {
      const { mismatch, skirt } = worstMismatch(earth, level, i, j);
      expect(mismatch).toBeLessThanOrEqual(skirt);
    }
  });

  it('Moon: cratered terrain at several levels', () => {
    for (const [level, i, j] of [[7, 70, 64], [10, 500, 520], [13, 4100, 4000]] as const) {
      const { mismatch, skirt } = worstMismatch(moon, level, i, j);
      expect(mismatch).toBeLessThanOrEqual(skirt);
    }
  });
});

describe('floating origin keeps float32 error negligible at planetary scale', () => {
  it('a vertex 1 km from the camera is exact to well under a millimetre even 6.4e6 m from the planet centre', () => {
    // Planet centre is camera-relative: camera sits at radius 6.371e6 + 2 m above the surface (+Y).
    const planetCentreRel = new Vector3(0, -(6_371_000 + 2), 0);
    const bodyQuat = new Quaternion().setFromAxisAngle(new Vector3(0.3, 1, 0.2).normalize(), 1.234);
    // A chunk origin, 1 km away along the surface, in the body-fixed frame (double precision).
    const originBF = new Vector3(0, 6_371_000 * Math.cos(1000 / 6_371_000), 6_371_000 * Math.sin(1000 / 6_371_000)).applyQuaternion(bodyQuat.clone().invert());
    // matrixWorld = T(planetCentreRel) * R(bodyQuat) * T(originBF): computed in double by three.js, uploaded as float32.
    const group = new Matrix4().compose(planetCentreRel, bodyQuat, new Vector3(1, 1, 1));
    const mesh = new Matrix4().makeTranslation(originBF.x, originBF.y, originBF.z);
    const world = group.clone().multiply(mesh);
    const exact = new Vector3().setFromMatrixPosition(world);
    const fround = new Vector3(Math.fround(exact.x), Math.fround(exact.y), Math.fround(exact.z));
    expect(exact.length()).toBeLessThan(1500);
    expect(exact.distanceTo(fround)).toBeLessThan(1e-3);
    // The naive alternative (absolute inertial positions in float32) would be off by ~0.5 m.
    const naive = new Vector3(Math.fround(6_371_000.37), 0, 0);
    expect(Math.abs(naive.x - 6_371_000.37)).toBeGreaterThan(0.01);
  });
});

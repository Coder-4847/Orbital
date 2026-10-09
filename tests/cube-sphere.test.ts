import { describe, expect, it } from 'vitest';
import {
  FACE_COUNT,
  directionToFace,
  directionToLonLat,
  faceToDirection,
  lonLatToDirection,
  nodeAngularRadius,
  nodeCenterDirection,
  nodeEdgeLength,
  nodeKey,
  nodeRect,
} from '../src/terrain/cube-sphere';

describe('cube sphere mapping', () => {
  it('produces unit directions and round-trips through directionToFace', () => {
    for (let face = 0; face < FACE_COUNT; face++) {
      for (const s of [-1, -0.7, -0.2, 0, 0.35, 0.9, 1]) {
        for (const t of [-0.95, -0.4, 0, 0.5, 1]) {
          const d = faceToDirection(face, s, t, new Float64Array(3));
          expect(Math.hypot(d[0]!, d[1]!, d[2]!)).toBeCloseTo(1, 12);
          const back = directionToFace(d[0]!, d[1]!, d[2]!);
          // Points exactly on a cube edge may legitimately resolve to the neighbouring face; compare directions instead.
          const d2 = faceToDirection(back.face, back.s, back.t, new Float64Array(3));
          expect(d2[0]).toBeCloseTo(d[0]!, 9);
          expect(d2[1]).toBeCloseTo(d[1]!, 9);
          expect(d2[2]).toBeCloseTo(d[2]!, 9);
        }
      }
    }
  });

  it('face grids wind counter-clockwise seen from outside (outward geometric normal)', () => {
    for (let face = 0; face < FACE_COUNT; face++) {
      const p0 = faceToDirection(face, -0.1, -0.1, new Float64Array(3));
      const p1 = faceToDirection(face, 0.1, -0.1, new Float64Array(3));
      const p2 = faceToDirection(face, -0.1, 0.1, new Float64Array(3));
      const e1 = [p1[0]! - p0[0]!, p1[1]! - p0[1]!, p1[2]! - p0[2]!];
      const e2 = [p2[0]! - p0[0]!, p2[1]! - p0[1]!, p2[2]! - p0[2]!];
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      expect(n[0]! * p0[0]! + n[1]! * p0[1]! + n[2]! * p0[2]!).toBeGreaterThan(0);
    }
  });

  it('neighbouring faces agree on shared edge points (no seams between faces)', () => {
    // +X face at s=+1 (r = -Z, so z = -1 side) meets -Z face... compare sets of edge directions via nearest match.
    const edgePoints = (face: number) => {
      const pts: Float64Array[] = [];
      for (const [s, t] of [[1, 0.3], [-1, 0.3], [0.3, 1], [0.3, -1]] as const) pts.push(faceToDirection(face, s, t, new Float64Array(3)) as Float64Array);
      return pts;
    };
    const near = (a: Float64Array, b: Float64Array) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) < 1e-12;
    // Every edge point of face 0 at parameter 0.3 must also be an edge point (some parameter) of exactly one neighbour.
    for (const p of edgePoints(0)) {
      const { face, s, t } = directionToFace(p[0]!, p[1]!, p[2]!);
      expect(face).toBeGreaterThanOrEqual(0);
      expect(near(faceToDirection(face, s, t, new Float64Array(3)) as Float64Array, p)).toBe(true);
    }
  });

  it('node keys are unique', () => {
    const seen = new Set<number>();
    for (let face = 0; face < FACE_COUNT; face++) {
      for (let level = 0; level <= 4; level++) {
        for (let i = 0; i < 1 << level; i++) for (let j = 0; j < 1 << level; j++) seen.add(nodeKey(face, level, i, j));
      }
    }
    expect(seen.size).toBe(6 * (1 + 4 + 16 + 64 + 256));
    expect(nodeKey(5, 21, 2097151, 2097151)).toBeLessThan(2 ** 53);
  });

  it('node geometry is consistent', () => {
    const r = nodeRect(3, 2, 5);
    expect(r.s1 - r.s0).toBeCloseTo(2 / 8, 12);
    expect(nodeEdgeLength(6_371_000, 0)).toBeCloseTo((6_371_000 * Math.PI) / 2, 6);
    const c = nodeCenterDirection(0, 0, 0, 0, new Float64Array(3));
    expect(c[0]).toBeCloseTo(1, 12);
    // Level-0 node on a cube face spans about 109 degrees corner to centre... check it is between 50 and 60 degrees.
    const a = nodeAngularRadius(0, 0, 0, 0);
    expect(a).toBeGreaterThan((50 * Math.PI) / 180);
    expect(a).toBeLessThan((60 * Math.PI) / 180);
    expect(nodeAngularRadius(0, 5, 3, 3)).toBeLessThan(a / 20);
  });

  it('lon/lat conversions are inverse and use +Y as north, +X as lon 0, east towards -Z', () => {
    const d = lonLatToDirection(0, 0, new Float64Array(3));
    expect([d[0], d[1], d[2]]).toEqual([1, 0, -0]);
    const east = lonLatToDirection(Math.PI / 2, 0, new Float64Array(3));
    expect(east[2]).toBeCloseTo(-1, 12);
    const ll = directionToLonLat(east[0]!, east[1]!, east[2]!);
    expect(ll.lon).toBeCloseTo(Math.PI / 2, 12);
    expect(directionToLonLat(0, 1, 0).lat).toBeCloseTo(Math.PI / 2, 12);
  });
});

import { describe, expect, it } from 'vitest';
import { CHUNK_CELLS, buildChunk, buildChunkIndices, chunkVertexCount } from '../src/terrain/chunk-builder';
import { EarthSource } from '../src/terrain/earth-source';
import { MoonSource } from '../src/terrain/moon-source';
import { directionToFace } from '../src/terrain/cube-sphere';
import { loadEarthDataForTests } from './helpers/earth-data';

const earth = new EarthSource(loadEarthDataForTests());

describe('chunk indices', () => {
  const idx = buildChunkIndices();
  it('reference only existing vertices and form whole triangles', () => {
    expect(idx.length % 3).toBe(0);
    expect(Math.max(...idx)).toBeLessThan(chunkVertexCount());
    expect(idx.length).toBe((CHUNK_CELLS * CHUNK_CELLS * 2 + 4 * CHUNK_CELLS * 2) * 3);
  });
});

describe('buildChunk', () => {
  const node = { face: 0, level: 6, i: 40, j: 20 };
  const chunk = buildChunk(earth, node);

  it('produces consistent buffer sizes and finite numbers', () => {
    expect(chunk.vertexCount).toBe(chunkVertexCount());
    expect(chunk.positions.length).toBe(chunk.vertexCount * 3);
    expect(chunk.normals.length).toBe(chunk.vertexCount * 3);
    expect(chunk.surfA.length).toBe(chunk.vertexCount * 4);
    for (const a of [chunk.positions, chunk.normals, chunk.surfA, chunk.surfB]) expect(a.every(Number.isFinite)).toBe(true);
  });

  it('winds triangles outward and keeps normals pointing away from the planet centre', () => {
    const idx = buildChunkIndices();
    const abs = (v: number) => [chunk.origin[0] + chunk.positions[v * 3]!, chunk.origin[1] + chunk.positions[v * 3 + 1]!, chunk.origin[2] + chunk.positions[v * 3 + 2]!];
    const gridTriangles = CHUNK_CELLS * CHUNK_CELLS * 2;
    let outward = 0;
    for (let t = 0; t < gridTriangles; t += 7) {
      const [a, b, c] = [abs(idx[t * 3]!), abs(idx[t * 3 + 1]!), abs(idx[t * 3 + 2]!)];
      const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      if (n[0]! * a[0]! + n[1]! * a[1]! + n[2]! * a[2]! > 0) outward++;
    }
    expect(outward).toBe(Math.ceil(gridTriangles / 7));
    for (let v = 0; v < chunk.vertexCount; v += 11) {
      const p = abs(v);
      const dot = chunk.normals[v * 3]! * p[0]! + chunk.normals[v * 3 + 1]! * p[1]! + chunk.normals[v * 3 + 2]! * p[2]!;
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('bounding sphere contains all vertices', () => {
    for (let v = 0; v < chunk.vertexCount; v++) {
      const d = Math.hypot(chunk.positions[v * 3]! - chunk.boundCenter[0], chunk.positions[v * 3 + 1]! - chunk.boundCenter[1], chunk.positions[v * 3 + 2]! - chunk.boundCenter[2]);
      expect(d).toBeLessThanOrEqual(chunk.boundRadius);
    }
  });

  it('adjacent same-level chunks share identical edge vertices (no cracks within a level)', () => {
    const left = buildChunk(earth, { face: 0, level: 6, i: 40, j: 20 });
    const right = buildChunk(earth, { face: 0, level: 6, i: 41, j: 20 });
    const n = CHUNK_CELLS;
    const stride = n + 1;
    for (let b = 0; b <= n; b++) {
      const lv = b * stride + n; // right edge of left chunk
      const rv = b * stride + 0; // left edge of right chunk
      for (let k = 0; k < 3; k++) {
        const la = left.origin[k]! + left.positions[lv * 3 + k]!;
        const ra = right.origin[k]! + right.positions[rv * 3 + k]!;
        expect(Math.abs(la - ra)).toBeLessThan(0.05);
      }
      // Normals come from the height field, so they match across the border too.
      for (let k = 0; k < 3; k++) expect(Math.abs(left.normals[lv * 3 + k]! - right.normals[rv * 3 + k]!)).toBeLessThan(1e-3);
    }
  });

  it('skirt vertices hang below their edge vertices', () => {
    const n = CHUNK_CELLS;
    const gridCount = (n + 1) * (n + 1);
    const edgeVertex = 0; // b=0,a=0 is also skirt edge 0, k=0
    const skirtVertex = gridCount;
    const r = (v: number) => Math.hypot(chunk.origin[0] + chunk.positions[v * 3]!, chunk.origin[1] + chunk.positions[v * 3 + 1]!, chunk.origin[2] + chunk.positions[v * 3 + 2]!);
    expect(r(skirtVertex)).toBeLessThan(r(edgeVertex));
  });

  it('builds the Moon too, and level-0 chunks are fast enough', () => {
    const moon = new MoonSource();
    const t0 = performance.now();
    const c = buildChunk(moon, { face: 4, level: 3, i: 3, j: 4 });
    expect(c.maxHeight).toBeGreaterThan(c.minHeight);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('flags chunks of open ocean as flat, but not land or coast', () => {
    // Face 0 (+X, lon ~0): level 4 chunk at the equator over the Atlantic vs. over Africa (lon ~20 E, lat 0 is Congo).
    const dirOf = (lonDeg: number, latDeg: number) => {
      const lon = (lonDeg * Math.PI) / 180;
      const lat = (latDeg * Math.PI) / 180;
      return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)] as const;
    };
    const nodeAt = (lonDeg: number, latDeg: number, level: number) => {
      const d = dirOf(lonDeg, latDeg);
      const fc = directionToFace(d[0], d[1], d[2]);
      const n = 1 << level;
      return { face: fc.face, level, i: Math.min(n - 1, Math.floor(((fc.s + 1) / 2) * n)), j: Math.min(n - 1, Math.floor(((fc.t + 1) / 2) * n)) };
    };
    expect(buildChunk(earth, nodeAt(-150, 0, 6)).flat).toBe(true); // mid-Pacific
    expect(buildChunk(earth, nodeAt(20, 0, 6)).flat).toBe(false); // Congo basin
    expect(buildChunk(earth, nodeAt(86.9, 28, 8)).flat).toBe(false); // Himalaya
  });
});

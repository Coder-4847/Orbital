import { faceToDirection, nodeEdgeLength, nodeKey, nodeRect, type TerrainNode } from './cube-sphere';
import { makeSurfaceSample, type TerrainSource } from './types';

/**
 * Cells per chunk edge. 64 gives 65x65 vertices (still 16-bit indexable): at equal triangle density it needs a quarter of
 * the draw calls of 32 cells, and draw-call overhead is what limits the frame time on mid-range machines.
 */
export const CHUNK_CELLS = 64;

/**
 * World-space period (metres) of the tiling detail textures. Per-vertex detail coordinates are body-fixed positions
 * wrapped by a multiple of this period, so neighbouring chunks sample identical texels while staying float32-safe.
 */
export const DETAIL_PERIOD = 2048;

export interface ChunkData {
  key: number;
  node: TerrainNode;
  /** Chunk origin in the body-fixed frame (double precision): the node's centre direction at sea level. */
  origin: [number, number, number];
  /** Vertex positions relative to `origin` (small, float32-safe). Grid vertices first, then skirt vertices. */
  positions: Float32Array;
  normals: Float32Array;
  /** Body-fixed position wrapped to a multiple of DETAIL_PERIOD: drives tiling detail noise. */
  detail: Float32Array;
  /** (elevation km, temperature, moisture, ice) per vertex. */
  surfA: Float32Array;
  /** (lights, tone, fresh, 0) per vertex. */
  surfB: Float32Array;
  vertexCount: number;
  /** True when the whole chunk is flat open water (every height exactly zero): it never needs finer geometry. */
  flat: boolean;
  /** Bounding sphere relative to origin. */
  boundCenter: [number, number, number];
  boundRadius: number;
  minHeight: number;
  maxHeight: number;
}

const gridVertexCount = (n: number) => (n + 1) * (n + 1);
export const chunkVertexCount = (n = CHUNK_CELLS) => gridVertexCount(n) + 4 * (n + 1);

/**
 * Triangle indices shared by every chunk (same topology). Grid triangles wind counter-clockwise seen from outside;
 * skirt quads hang under the four edges (edges listed counter-clockwise, so the same quad pattern faces outward).
 */
export function buildChunkIndices(n = CHUNK_CELLS): Uint16Array {
  const stride = n + 1;
  const indices: number[] = [];
  for (let b = 0; b < n; b++) {
    for (let a = 0; a < n; a++) {
      const i0 = b * stride + a;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      indices.push(i0, i1, i2, i1, i3, i2);
    }
  }
  const skirtBase = gridVertexCount(n);
  // Edge vertex ids in counter-clockwise order; skirt vertex k of edge e has id skirtBase + e*stride + k.
  const edgeIds = (e: number, k: number): number => {
    switch (e) {
      case 0: return k; // b = 0, a = 0..n
      case 1: return k * stride + n; // a = n, b = 0..n
      case 2: return n * stride + (n - k); // b = n, a = n..0
      default: return (n - k) * stride; // a = 0, b = n..0
    }
  };
  for (let e = 0; e < 4; e++) {
    for (let k = 0; k < n; k++) {
      const a = edgeIds(e, k);
      const b = edgeIds(e, k + 1);
      const a2 = skirtBase + e * stride + k;
      const b2 = a2 + 1;
      indices.push(a, a2, b, a2, b2, b);
    }
  }
  return Uint16Array.from(indices); // a chunk has ~1.2k vertices, well inside 16 bits
}

/**
 * Generate one terrain chunk: sample the height field on a (n+3)^2 grid (one extra ring so normals can be taken from
 * the height function itself, which keeps lighting continuous across chunk and LOD boundaries), then emit vertices.
 */
export function buildChunk(source: TerrainSource, node: TerrainNode, n = CHUNK_CELLS): ChunkData {
  const { face, level, i, j } = node;
  const R = source.radius;
  const rect = nodeRect(level, i, j);
  const ds = (rect.s1 - rect.s0) / n;
  const dt = (rect.t1 - rect.t0) / n;
  const edgeLength = nodeEdgeLength(R, level);
  const spacing = edgeLength / n;

  const gs = n + 3;
  const heights = new Float64Array(gs * gs);
  const dirs = new Float64Array(gs * gs * 3);
  const dir = new Float64Array(3);
  const sample = makeSurfaceSample();

  const stride = n + 1;
  const vCount = chunkVertexCount(n);
  const gridCount = gridVertexCount(n);
  const surfA = new Float32Array(vCount * 4);
  const surfB = new Float32Array(vCount * 4);

  let minH = Infinity;
  let maxH = -Infinity;

  for (let b = -1; b <= n + 1; b++) {
    for (let a = -1; a <= n + 1; a++) {
      faceToDirection(face, rect.s0 + a * ds, rect.t0 + b * dt, dir);
      const gi = (b + 1) * gs + (a + 1);
      dirs[gi * 3] = dir[0]!;
      dirs[gi * 3 + 1] = dir[1]!;
      dirs[gi * 3 + 2] = dir[2]!;
      source.sample(dir[0]!, dir[1]!, dir[2]!, spacing, sample);
      heights[gi] = sample.height;
      if (a >= 0 && a <= n && b >= 0 && b <= n) {
        const v = b * stride + a;
        surfA[v * 4] = sample.elevation / 1000;
        surfA[v * 4 + 1] = sample.temperature;
        surfA[v * 4 + 2] = sample.moisture;
        surfA[v * 4 + 3] = sample.ice;
        surfB[v * 4] = sample.lights;
        surfB[v * 4 + 1] = sample.tone;
        surfB[v * 4 + 2] = sample.fresh;
        if (sample.height < minH) minH = sample.height;
        if (sample.height > maxH) maxH = sample.height;
      }
    }
  }

  // Origin: centre direction at sea level.
  const centre = faceToDirection(face, (rect.s0 + rect.s1) / 2, (rect.t0 + rect.t1) / 2, new Float64Array(3));
  const ox = centre[0]! * R;
  const oy = centre[1]! * R;
  const oz = centre[2]! * R;

  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const detail = new Float32Array(vCount * 3);
  const wrapX = ox - Math.round(ox / DETAIL_PERIOD) * DETAIL_PERIOD;
  const wrapY = oy - Math.round(oy / DETAIL_PERIOD) * DETAIL_PERIOD;
  const wrapZ = oz - Math.round(oz / DETAIL_PERIOD) * DETAIL_PERIOD;

  // Absolute (double) position of a grid point, for normals.
  const px = (a: number, b: number, axis: number): number => {
    const gi = (b + 1) * gs + (a + 1);
    return dirs[gi * 3 + axis]! * (R + heights[gi]!);
  };

  // Skirts only need to cover the height mismatch between neighbouring LODs (omitted octaves), which is a fraction of the cell size.
  const skirt = Math.min(spacing * 0.7 + 0.3, 12000);

  let bminx = Infinity, bminy = Infinity, bminz = Infinity, bmaxx = -Infinity, bmaxy = -Infinity, bmaxz = -Infinity;
  const writeVertex = (v: number, a: number, b: number, drop: number) => {
    const gi = (b + 1) * gs + (a + 1);
    const r = R + heights[gi]! - drop;
    const x = dirs[gi * 3]! * r - ox;
    const y = dirs[gi * 3 + 1]! * r - oy;
    const z = dirs[gi * 3 + 2]! * r - oz;
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
    detail[v * 3] = wrapX + x;
    detail[v * 3 + 1] = wrapY + y;
    detail[v * 3 + 2] = wrapZ + z;
    if (x < bminx) bminx = x;
    if (y < bminy) bminy = y;
    if (z < bminz) bminz = z;
    if (x > bmaxx) bmaxx = x;
    if (y > bmaxy) bmaxy = y;
    if (z > bmaxz) bmaxz = z;

    // Normal = (dP/ds) x (dP/dt) from central differences of the real height field.
    const sx = px(a + 1, b, 0) - px(a - 1, b, 0);
    const sy = px(a + 1, b, 1) - px(a - 1, b, 1);
    const sz = px(a + 1, b, 2) - px(a - 1, b, 2);
    const tx = px(a, b + 1, 0) - px(a, b - 1, 0);
    const ty = px(a, b + 1, 1) - px(a, b - 1, 1);
    const tz = px(a, b + 1, 2) - px(a, b - 1, 2);
    let nx = sy * tz - sz * ty;
    let ny = sz * tx - sx * tz;
    let nz = sx * ty - sy * tx;
    const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
    nx *= inv;
    ny *= inv;
    nz *= inv;
    normals[v * 3] = nx;
    normals[v * 3 + 1] = ny;
    normals[v * 3 + 2] = nz;
  };

  for (let b = 0; b <= n; b++) for (let a = 0; a <= n; a++) writeVertex(b * stride + a, a, b, 0);

  // Skirt vertices copy the edge vertex's attributes, dropped along the radial direction.
  const edgeAB = (e: number, k: number): [number, number] => {
    switch (e) {
      case 0: return [k, 0];
      case 1: return [n, k];
      case 2: return [n - k, n];
      default: return [0, n - k];
    }
  };
  for (let e = 0; e < 4; e++) {
    for (let k = 0; k <= n; k++) {
      const [a, b] = edgeAB(e, k);
      const v = gridCount + e * stride + k;
      writeVertex(v, a, b, skirt);
      const src = b * stride + a;
      surfA.copyWithin(v * 4, src * 4, src * 4 + 4);
      surfB.copyWithin(v * 4, src * 4, src * 4 + 4);
    }
  }

  const cx = (bminx + bmaxx) / 2;
  const cy = (bminy + bmaxy) / 2;
  const cz = (bminz + bmaxz) / 2;
  let r2 = 0;
  for (let v = 0; v < vCount; v++) {
    const dx = positions[v * 3]! - cx;
    const dy = positions[v * 3 + 1]! - cy;
    const dz = positions[v * 3 + 2]! - cz;
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }

  return {
    key: nodeKey(face, level, i, j),
    node,
    origin: [ox, oy, oz],
    positions,
    normals,
    detail,
    surfA,
    surfB,
    vertexCount: vCount,
    flat: minH === 0 && maxH === 0,
    boundCenter: [cx, cy, cz],
    boundRadius: Math.sqrt(r2) * 1.001 + 1,
    minHeight: minH,
    maxHeight: maxH,
  };
}

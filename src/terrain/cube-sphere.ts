/**
 * Cubed-sphere geometry helpers. Pure math, no rendering imports (safe in workers and tests).
 *
 * Each of the 6 cube faces is a quadtree. A node is (face, level, i, j) with 0 <= i,j < 2^level and covers
 * face coordinates s,t in [-1,1] (before the tangent warp). Face axes are chosen so right x up = outward normal,
 * which makes a grid walked in (s,t) wind counter-clockwise when seen from outside.
 */

export const FACE_COUNT = 6;

interface FaceAxes {
  n: readonly [number, number, number];
  r: readonly [number, number, number];
  u: readonly [number, number, number];
}

export const FACES: readonly FaceAxes[] = [
  { n: [1, 0, 0], r: [0, 0, -1], u: [0, 1, 0] },
  { n: [-1, 0, 0], r: [0, 0, 1], u: [0, 1, 0] },
  { n: [0, 1, 0], r: [1, 0, 0], u: [0, 0, -1] },
  { n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1] },
  { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] },
  { n: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0] },
];

/** Tangent warp: spreads cells more evenly over the sphere than a plain cube projection (max/min area ratio ~1.4 vs 5). */
const warp = (x: number): number => Math.tan((x * Math.PI) / 4);
const unwarp = (x: number): number => (Math.atan(x) * 4) / Math.PI;

/** Unit direction for face coordinates (s,t) in [-1,1]. */
export function faceToDirection(face: number, s: number, t: number, out: Float64Array | number[] = new Float64Array(3)): Float64Array | number[] {
  const f = FACES[face]!;
  const ws = warp(s);
  const wt = warp(t);
  const x = f.n[0] + ws * f.r[0] + wt * f.u[0];
  const y = f.n[1] + ws * f.r[1] + wt * f.u[1];
  const z = f.n[2] + ws * f.r[2] + wt * f.u[2];
  const inv = 1 / Math.hypot(x, y, z);
  out[0] = x * inv;
  out[1] = y * inv;
  out[2] = z * inv;
  return out;
}

export interface FaceCoord {
  face: number;
  s: number;
  t: number;
}

/** Inverse of faceToDirection. `d` need not be normalised. */
export function directionToFace(x: number, y: number, z: number): FaceCoord {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let face: number;
  if (ax >= ay && ax >= az) face = x > 0 ? 0 : 1;
  else if (ay >= az) face = y > 0 ? 2 : 3;
  else face = z > 0 ? 4 : 5;
  const f = FACES[face]!;
  const dn = x * f.n[0] + y * f.n[1] + z * f.n[2];
  const s = unwarp((x * f.r[0] + y * f.r[1] + z * f.r[2]) / dn);
  const t = unwarp((x * f.u[0] + y * f.u[1] + z * f.u[2]) / dn);
  return { face, s, t };
}

export interface TerrainNode {
  face: number;
  level: number;
  i: number;
  j: number;
}

const TWO21 = 2097152; // 2^21; i,j < 2^21 for levels <= 21

/** Numeric key unique for (face, level, i, j) with level <= 21: fits in 53 bits, no string allocation. */
export function nodeKey(face: number, level: number, i: number, j: number): number {
  return ((face * 32 + level) * TWO21 + i) * TWO21 + j;
}

/** Face-coordinate rectangle of a node. */
export function nodeRect(level: number, i: number, j: number): { s0: number; s1: number; t0: number; t1: number } {
  const n = 1 << level;
  return { s0: -1 + (2 * i) / n, s1: -1 + (2 * (i + 1)) / n, t0: -1 + (2 * j) / n, t1: -1 + (2 * (j + 1)) / n };
}

export function nodeCenterDirection(face: number, level: number, i: number, j: number, out: Float64Array | number[] = new Float64Array(3)): Float64Array | number[] {
  const r = nodeRect(level, i, j);
  return faceToDirection(face, (r.s0 + r.s1) / 2, (r.t0 + r.t1) / 2, out);
}

/** Largest angle (radians) between a node's centre direction and any point of its patch (corners and edge midpoints are checked). */
export function nodeAngularRadius(face: number, level: number, i: number, j: number): number {
  const r = nodeRect(level, i, j);
  const sc = (r.s0 + r.s1) / 2;
  const tc = (r.t0 + r.t1) / 2;
  const c = faceToDirection(face, sc, tc, new Float64Array(3));
  const p = new Float64Array(3);
  let maxAngle = 0;
  for (const s of [r.s0, sc, r.s1]) {
    for (const t of [r.t0, tc, r.t1]) {
      faceToDirection(face, s, t, p);
      const dot = Math.min(1, c[0]! * p[0]! + c[1]! * p[1]! + c[2]! * p[2]!);
      maxAngle = Math.max(maxAngle, Math.acos(dot));
    }
  }
  return maxAngle;
}

/** Approximate edge length in metres of a node on a body of the given radius (arc across the face centre). */
export const nodeEdgeLength = (radius: number, level: number): number => (radius * Math.PI * 0.5) / (1 << level);

/** The parent of a node (undefined for roots). */
export function parentOf(node: TerrainNode): TerrainNode | undefined {
  return node.level === 0 ? undefined : { face: node.face, level: node.level - 1, i: node.i >> 1, j: node.j >> 1 };
}

/** Longitude/latitude (radians) of a body-fixed unit direction. +Y is north; lon 0 is +X; east is towards -Z. */
export function directionToLonLat(x: number, y: number, z: number): { lon: number; lat: number } {
  return { lon: Math.atan2(-z, x), lat: Math.asin(Math.max(-1, Math.min(1, y))) };
}

export function lonLatToDirection(lon: number, lat: number, out: Float64Array | number[] = new Float64Array(3)): Float64Array | number[] {
  const c = Math.cos(lat);
  out[0] = c * Math.cos(lon);
  out[1] = Math.sin(lat);
  out[2] = -c * Math.sin(lon);
  return out;
}

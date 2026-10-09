/** Pure level-of-detail rules for the cubed-sphere quadtree (unit-tested; no rendering imports). */

/**
 * Angle (radians) between the camera's sub-point and the farthest surface point that can still be visible,
 * including mountains of height `maxHeight` poking over the geometric horizon.
 */
export function horizonAngle(radius: number, maxHeight: number, cameraDistance: number): number {
  const camPart = cameraDistance > radius ? Math.acos(radius / cameraDistance) : 0;
  return camPart + Math.acos(radius / (radius + maxHeight));
}

/** True when a node (direction `n`, angular radius `rho`) is entirely hidden behind the horizon. */
export function isBehindHorizon(
  cx: number, cy: number, cz: number, cameraDistance: number,
  nx: number, ny: number, nz: number, rho: number,
  radius: number, maxHeight: number,
): boolean {
  if (cameraDistance <= radius) return false;
  const dot = (cx * nx + cy * ny + cz * nz) / cameraDistance;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  return angle > rho + horizonAngle(radius, maxHeight, cameraDistance) + 0.002;
}

/**
 * Split a node when the camera is nearer than `factor` edge lengths from it.
 * `factor` ~ (pixels per radian) / (target pixels per cell) / cells per chunk edge: with 64 cells, 2.7 targets ~6 px cells at
 * 1080p and 55 degrees FOV (1036 px/rad / 6 px / 64).
 */
export function shouldSplit(distanceToNode: number, edgeLength: number, level: number, maxLevel: number, factor: number): boolean {
  return level < maxLevel && distanceToNode < edgeLength * factor;
}

export interface TerrainQuality {
  /** Split factor (see shouldSplit). */
  splitFactor: number;
  /** Soft cap on resident chunk meshes per body. */
  maxChunks: number;
}

export const TERRAIN_QUALITY: readonly TerrainQuality[] = [
  { splitFactor: 1.8, maxChunks: 500 }, // Low
  { splitFactor: 2.6, maxChunks: 800 }, // Medium
  { splitFactor: 3.75, maxChunks: 1300 }, // High
  { splitFactor: 5.5, maxChunks: 2200 }, // Ultra
];

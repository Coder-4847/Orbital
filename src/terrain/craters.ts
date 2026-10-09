import { smoothstep } from './noise';

/** Procedural crater height profile in metres for normalised radius x = distance / craterRadius. */
export function craterProfile(x: number, diameterM: number): number {
  const ratio = diameterM < 15_000 ? 0.05 + 0.13 * Math.min(1, diameterM / 15_000) : diameterM > 100_000 ? 0.06 : 0.18 - (0.12 * (diameterM - 15_000)) / 85_000; // small craters are old and soft
  const depth = Math.min(diameterM * ratio, 4600); // even basin-sized craters are only a few km deep
  const rimH = Math.min(diameterM * (diameterM < 15_000 ? 0.04 : 0.02), 1200);
  let h = 0;
  if (x < 1) h = depth * (x * x - 1) * (x < 0.15 && diameterM > 60_000 ? 0.75 : 1); // bowl; large craters get a central peak
  if (diameterM > 60_000 && x < 0.18) h += depth * 0.35 * (1 - x / 0.18);
  h += rimH * Math.exp(-(((x - 1) / 0.16) ** 2));
  if (x > 1) h += rimH * 0.55 * Math.pow(x, -2.6) * smoothstep(4, 1.2, x);
  return h;
}

export function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1274126177) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}


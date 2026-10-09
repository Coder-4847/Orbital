/** Per-point result of a terrain source. All heights are metres relative to the body's reference radius (sea level). */
export interface SurfaceSample {
  /** Rendered/collidable surface height. Equals 0 over water (the sea surface is flat). */
  height: number;
  /** Signed elevation: negative = water depth below sea level. Used for colouring, not collision. */
  elevation: number;
  /** 0 (arctic) .. 1 (hot). Earth only. */
  temperature: number;
  /** 0 (arid) .. 1 (wet). Earth only. */
  moisture: number;
  /** Snow / ice cover 0..1. */
  ice: number;
  /** Night-light density 0..1. Earth only. */
  lights: number;
  /** Extra per-body scalar: Moon uses it as mare (dark basalt) fraction, 0..1. */
  tone: number;
  /** Extra per-body scalar: Moon uses it as fresh-crater / ejecta brightness, 0..1. */
  fresh: number;
}

export const makeSurfaceSample = (): SurfaceSample => ({ height: 0, elevation: 0, temperature: 0, moisture: 0, ice: 0, lights: 0, tone: 0, fresh: 0 });

export interface TerrainSource {
  readonly id: string;
  /** Reference radius in metres. */
  readonly radius: number;
  /** Upper bound on |height| used for conservative bounding volumes. */
  readonly maxHeight: number;
  /**
   * Sample the surface in direction (x,y,z) (unit vector, body-fixed frame).
   * `spacing` is the approximate distance in metres between samples; octaves finer than 2*spacing are skipped.
   * Pass a small spacing (<1) for full-detail collision queries.
   */
  sample(x: number, y: number, z: number, spacing: number, out: SurfaceSample): void;
}

/** A body id from the catalogue that has terrain (see source-registry). */
export type BodyTerrainId = string;

import type { SurfaceSample, TerrainSource } from './types';

/** A perfectly smooth sphere: the Sun and the gas giants. Their appearance comes entirely from shaders. */
export class SphereSource implements TerrainSource {
  readonly maxHeight = 1000;

  constructor(
    readonly id: string,
    readonly radius: number,
  ) {}

  sample(_x: number, _y: number, _z: number, _spacing: number, out: SurfaceSample): void {
    out.height = 0;
    out.elevation = 0;
    out.temperature = 0;
    out.moisture = 0;
    out.ice = 0;
    out.lights = 0;
    out.tone = 0;
    out.fresh = 0;
  }
}

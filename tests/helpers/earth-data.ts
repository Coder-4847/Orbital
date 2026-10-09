import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import type { EarthData } from '../../src/terrain/earth-source';
import type { Raster8 } from '../../src/terrain/sampling';

function load(file: string): Raster8 {
  const png = PNG.sync.read(readFileSync(new URL(`../../src/assets/data/${file}`, import.meta.url)));
  const data = new Uint8Array(png.width * png.height);
  for (let i = 0; i < data.length; i++) data[i] = png.data[i * 4]!; // grayscale: R channel
  return { data, width: png.width, height: png.height };
}

let cached: EarthData | undefined;

/** Loads the baked Earth rasters from disk (tests only; the app decodes them in the browser). */
export function loadEarthDataForTests(): EarthData {
  return (cached ??= {
    elevation: load('earth-elevation.png'),
    land: load('earth-land.png'),
    coast: load('earth-coast.png'),
    lights: load('earth-lights.png'),
  });
}

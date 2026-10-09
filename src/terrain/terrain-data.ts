import elevationUrl from '../assets/data/earth-elevation.png?url';
import landUrl from '../assets/data/earth-land.png?url';
import coastUrl from '../assets/data/earth-coast.png?url';
import lightsUrl from '../assets/data/earth-lights.png?url';
import type { EarthData } from './earth-source';
import type { Raster8 } from './sampling';

/** Decode a grayscale PNG into a plain byte raster (R channel). Browser only. */
async function loadRaster(url: string): Promise<Raster8> {
  const blob = await (await fetch(url)).blob();
  // 'none' keeps the stored values exactly: these are data, not colours.
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const { width, height } = bitmap; // read before close(): a closed bitmap reports 0x0
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4]!;
  bitmap.close();
  return { data, width, height };
}

let earthData: Promise<EarthData> | undefined;

/** Loads (once) the baked Earth rasters. The same bytes are handed to the terrain workers. */
export function loadEarthData(): Promise<EarthData> {
  return (earthData ??= Promise.all([loadRaster(elevationUrl), loadRaster(landUrl), loadRaster(coastUrl), loadRaster(lightsUrl)]).then(([elevation, land, coast, lights]) => ({ elevation, land, coast, lights })));
}

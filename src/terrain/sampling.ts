/** Equirectangular raster: row 0 is north, column 0 is lon -180. 8 bits per texel. */
export interface Raster8 {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Bilinear sample at (lon, lat) in radians. Wraps in longitude, clamps in latitude. Returns 0..255. */
export function sampleRaster(r: Raster8, lon: number, lat: number): number {
  const w = r.width;
  const h = r.height;
  const u = ((lon + Math.PI) / (2 * Math.PI)) * w - 0.5;
  const v = ((Math.PI / 2 - lat) / Math.PI) * h - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const xa = ((x0 % w) + w) % w;
  const xb = (xa + 1) % w;
  const ya = Math.min(h - 1, Math.max(0, y0));
  const yb = Math.min(h - 1, Math.max(0, y0 + 1));
  const d = r.data;
  const a = d[ya * w + xa]! * (1 - fx) + d[ya * w + xb]! * fx;
  const b = d[yb * w + xa]! * (1 - fx) + d[yb * w + xb]! * fx;
  return a * (1 - fy) + b * fy;
}

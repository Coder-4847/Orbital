import { ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, UnsignedByteType } from 'three/webgpu';
import type { Raster8 } from '../terrain/sampling';

/** Upload an equirectangular 8-bit raster as a single-channel texture (wraps in longitude, clamps at the poles). */
export function createRasterTexture(raster: Raster8): DataTexture {
  const tex = new DataTexture(raster.data, raster.width, raster.height, RedFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

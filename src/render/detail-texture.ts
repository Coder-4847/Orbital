import { DataTexture, LinearMipmapLinearFilter, LinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three/webgpu';

/** Tileable value noise: octave `o` has 2^o * baseCells cells across the texture, wrapping seamlessly. */
function tileableNoise(size: number, baseCells: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    // Random lattice values for this octave.
    const lattice = new Float32Array(cells * cells);
    let a = (seed * 7919 + o * 104729) >>> 0;
    for (let i = 0; i < lattice.length; i++) {
      a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
      lattice[i] = a / 4294967296;
    }
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % cells;
        const y1 = (y0 + 1) % cells;
        const v00 = lattice[y0 * cells + x0]!;
        const v10 = lattice[y0 * cells + x1]!;
        const v01 = lattice[y1 * cells + x0]!;
        const v11 = lattice[y1 * cells + x1]!;
        out[y * size + x] = out[y * size + x]! + amp * ((v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy);
      }
    }
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / norm;
  return out;
}

/**
 * RGBA8 tiling noise: four independent fractal channels in [0,1]. Sampled triplanar at several scales by the terrain
 * shader. Generated procedurally at start-up (about 10 ms), so nothing is downloaded.
 */
export function createDetailTexture(size = 256): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let c = 0; c < 4; c++) {
    const ch = tileableNoise(size, 4, 5, 101 + c * 37);
    for (let i = 0; i < size * size; i++) data[i * 4 + c] = Math.round(Math.min(1, Math.max(0, (ch[i]! - 0.5) * 1.9 + 0.5)) * 255);
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

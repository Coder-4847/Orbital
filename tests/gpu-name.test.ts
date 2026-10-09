import { describe, expect, it } from 'vitest';
import { cleanGpuName, suggestPreset } from '../src/render/gpu-name';

describe('cleanGpuName', () => {
  it('strips ANGLE wrapper, hex id and D3D suffix', () => {
    expect(cleanGpuName('ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Laptop GPU (0x00002C59) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('NVIDIA GeForce RTX 5080 Laptop GPU');
    expect(cleanGpuName('ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('Intel(R) UHD Graphics');
  });
  it('passes plain names through', () => {
    expect(cleanGpuName('Apple M2')).toBe('Apple M2');
  });
});

describe('suggestPreset', () => {
  it('starts discrete GPUs on High and integrated or unknown ones on Medium', () => {
    expect(suggestPreset('WebGPU · nvidia blackwell')).toBe('high');
    expect(suggestPreset('WebGL 2 · NVIDIA GeForce GTX 1650')).toBe('high');
    expect(suggestPreset('WebGPU · amd rdna-3')).toBe('high');
    expect(suggestPreset('WebGPU · apple metal-3')).toBe('high');
    expect(suggestPreset('WebGPU · intel gen-12lp')).toBe('medium');
    expect(suggestPreset('WebGL 2 · Intel(R) UHD Graphics')).toBe('medium');
    expect(suggestPreset('WebGL 2')).toBe('medium');
  });
  it('puts software renderers on Low', () => {
    expect(suggestPreset('WebGL 2 · Google SwiftShader')).toBe('low');
    expect(suggestPreset('WebGL 2 · llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('low');
  });
});

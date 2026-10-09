import type { BufferAttribute, WebGPURenderer } from 'three/webgpu';

/**
 * True once the renderer has created the GPU buffer for `attribute`. three.js keeps that bookkeeping in a private map shared by
 * the WebGPU and WebGL backends; if a future version moves it, this returns false and callers simply keep their CPU arrays.
 */
export function uploaded(renderer: WebGPURenderer, attribute: BufferAttribute): boolean {
  const attributes = (renderer as unknown as { _attributes?: { has?(a: BufferAttribute): boolean } })._attributes;
  return attributes?.has?.(attribute) === true;
}

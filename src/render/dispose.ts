import { Sprite, type Material, type Mesh, type Object3D } from 'three/webgpu';

/**
 * Release GPU resources for everything under `root`. Call from a scene's exit().
 * Sprites share one module-level geometry inside three.js, so their geometry must never be disposed.
 */
export function disposeTree(root: Object3D): void {
  const seen = new Set<unknown>();
  root.traverse((obj) => {
    const item = obj as Mesh;
    if (!item.geometry && !item.material) return;
    if (!(obj instanceof Sprite) && item.geometry && !seen.has(item.geometry)) {
      seen.add(item.geometry);
      item.geometry.dispose();
    }
    const material = item.material as Material | Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      if (!seen.has(m)) {
        seen.add(m);
        m.dispose();
      }
    }
  });
}

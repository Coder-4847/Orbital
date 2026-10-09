/**
 * Depth range of the flight camera. With reversed-Z the range can stay huge; without it (a WebGL2 fallback) near and far must
 * follow the camera: close to the vessel, far enough for the Moon (or, in the map, for the whole system).
 */
import { MathUtils, type PerspectiveCamera, type Vector3 } from 'three/webgpu';
import type { SkyBackdrop } from '../render/sky-backdrop';
import { vlen, vsub, type V3 } from '../flight/math3';

export const MAP_FAR = 1e13;
const FLIGHT_FAR = 1.2e9;

function apply(camera: PerspectiveCamera, near: number, far: number): void {
  if (Math.abs(near - camera.near) / near > 0.05 || camera.far !== far) {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}

/** `planet` is the body's world position, `camWorld` the camera's, `vesselPos` the vessel in the planet frame. */
export function fitFlightDepth(camera: PerspectiveCamera, sky: SkyBackdrop, planet: Vector3, camWorld: Vector3, vesselPos: V3): void {
  const d = vlen(vsub([camWorld.x - planet.x, camWorld.y - planet.y, camWorld.z - planet.z], vesselPos));
  apply(camera, MathUtils.clamp(d * 0.03, 0.1, 100), FLIGHT_FAR);
  sky.setDistanceScale((FLIGHT_FAR * 0.45) / 5e10);
}

/** `vesselWorld` is the vessel's world position, or null when there is no vessel to look at. */
export function fitMapDepth(camera: PerspectiveCamera, sky: SkyBackdrop, camWorld: Vector3, vesselWorld: Vector3 | null): void {
  const d = vesselWorld ? camWorld.distanceTo(vesselWorld) : 1e7;
  apply(camera, MathUtils.clamp(d * 0.01, 10, 1e7), MAP_FAR);
  sky.setDistanceScale(1);
}

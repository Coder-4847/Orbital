import { Matrix4, Vector3, Vector4 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { SUN_IRRADIANCE } from './atmosphere-model';

/**
 * Per-planet shader inputs shared by the terrain material and the atmosphere pass.
 * All vectors are in render space: world axes, camera at the origin (floating origin).
 */
export class PlanetUniforms {
  /** Planet centre relative to the camera, metres. */
  readonly center = uniform(new Vector3());
  /** Unit direction towards the sun. */
  readonly sunDir = uniform(new Vector3(0, 0, 1));
  /** Sun irradiance above the atmosphere (RGB). */
  readonly sunE = uniform(new Vector3(...SUN_IRRADIANCE));
  /** Sun centre relative to the camera (m), for eclipse geometry. */
  readonly sunPos = uniform(new Vector3());
  /** Up to two bodies that can shadow this one: (centre relative to the camera, radius). Radius 0 = unused. */
  readonly occluderA = uniform(new Vector4());
  readonly occluderB = uniform(new Vector4());
  /** The body's north pole (unit vector, world axes). */
  readonly pole = uniform(new Vector3(0, 1, 0));
  /** Inertial -> body-fixed rotation, to look up longitude/latitude from a world direction. */
  readonly bodyInverse = uniform(new Matrix4());
  /** Seconds, for animated water. */
  readonly time = uniform(0);
}

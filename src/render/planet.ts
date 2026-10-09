import { Quaternion, Vector3 } from 'three/webgpu';
import type { BodyDef } from '../data/solar-system';
import { directionToLonLat } from '../terrain/cube-sphere';
import type { TerrainBody } from '../terrain/terrain-body';
import { makeSurfaceSample, type TerrainSource } from '../terrain/types';
import type { TransmittanceLut } from './atmosphere-lut';
import type { AtmosphereDef } from './atmosphere-model';
import { PlanetUniforms } from './planet-uniforms';

export interface PlanetInit {
  def: BodyDef;
  source: TerrainSource;
  terrain: TerrainBody;
  uniforms: PlanetUniforms;
  atmosphere?: { def: AtmosphereDef; lut: TransmittanceLut };
}

/** Angular radius (radians) above which a body gets real terrain; below half of it the terrain is released. */
const RESOLVE_ABOVE = 0.0012;
const RELEASE_BELOW = 0.0006;

/**
 * A rendered world: simulation state in double precision (position, orientation) plus the camera-relative placement of
 * its terrain every frame. This is where the floating origin is applied. Bodies too small to resolve are dormant.
 */
export class Planet {
  readonly def: BodyDef;
  readonly id: string;
  readonly source: TerrainSource;
  readonly terrain: TerrainBody;
  readonly uniforms: PlanetUniforms;
  readonly atmosphere?: { def: AtmosphereDef; lut: TransmittanceLut };

  /** Centre in the inertial (heliocentric) frame, double precision, metres. */
  readonly position = new Vector3();
  /** Body-fixed -> inertial rotation. */
  readonly orientation = new Quaternion();

  /** Camera in the body-fixed frame (metres from the centre), refreshed by update(). */
  readonly cameraBodyFixed = new Vector3();
  /** Centre relative to the camera (m), refreshed by update(). */
  readonly relative = new Vector3();
  /** Angular radius of the body as seen by the camera (radians). */
  angularRadius = 0;

  private readonly inverseOrientation = new Quaternion();
  private readonly orientationInverse = new Quaternion();
  private readonly scratch = new Vector3();
  private readonly sampleScratch = makeSurfaceSample();

  constructor(init: PlanetInit) {
    this.def = init.def;
    this.id = init.def.id;
    this.source = init.source;
    this.terrain = init.terrain;
    this.uniforms = init.uniforms;
    this.atmosphere = init.atmosphere;
  }

  get radius(): number {
    return this.source.radius;
  }

  /** True while the body is big enough on screen to carry terrain. */
  get resolved(): boolean {
    return this.terrain.isActive;
  }

  /** Place the terrain relative to the camera and refresh LOD. `cameraWorld` is the camera's double-precision inertial position. */
  update(cameraWorld: Vector3): void {
    this.relative.subVectors(this.position, cameraWorld); // centre relative to the camera: small enough for float32 where it matters
    const distance = this.relative.length();
    this.angularRadius = this.radius / Math.max(distance, 1);

    if (this.angularRadius > RESOLVE_ABOVE) this.terrain.setActive(true);
    else if (this.angularRadius < RELEASE_BELOW) this.terrain.setActive(false);

    this.terrain.group.position.copy(this.relative);
    this.terrain.group.quaternion.copy(this.orientation);
    this.uniforms.center.value.copy(this.relative);

    this.inverseOrientation.copy(this.orientation).invert();
    this.uniforms.bodyInverse.value.makeRotationFromQuaternion(this.inverseOrientation);
    this.uniforms.pole.value.set(0, 1, 0).applyQuaternion(this.orientation);
    this.cameraBodyFixed.copy(cameraWorld).sub(this.position).applyQuaternion(this.inverseOrientation);
    this.terrain.update(this.cameraBodyFixed);
  }

  /** Distance from the centre, metres. */
  distanceFrom(cameraWorld: Vector3): number {
    return this.scratch.subVectors(cameraWorld, this.position).length();
  }

  /** Terrain surface height (metres above the reference radius) under a point given in the inertial frame. Full detail. */
  surfaceHeightUnder(pointWorld: Vector3, spacing = 0.5): number {
    // Uses the body's current orientation, not the render-time cache: flight physics advances the planet many times per frame.
    const d = this.scratch.copy(pointWorld).sub(this.position).applyQuaternion(this.orientationInverse.copy(this.orientation).invert()).normalize();
    this.source.sample(d.x, d.y, d.z, spacing, this.sampleScratch);
    return this.sampleScratch.height;
  }

  /** Longitude/latitude (degrees) under a point in the inertial frame. */
  lonLatUnder(pointWorld: Vector3): { lon: number; lat: number } {
    const d = this.scratch.copy(pointWorld).sub(this.position).applyQuaternion(this.orientationInverse.copy(this.orientation).invert()).normalize();
    const ll = directionToLonLat(d.x, d.y, d.z);
    return { lon: (ll.lon * 180) / Math.PI, lat: (ll.lat * 180) / Math.PI };
  }
}

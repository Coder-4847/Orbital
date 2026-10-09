import { AmbientLight, Color, HemisphereLight, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { disposeTree } from './dispose';
import { EarthLite } from './earth-lite';
import { Starfield } from './starfield';
import { Sun } from './sun';

/** Scale of the stand-in world: Earth's radius in scene units, and the orbit height used by menu/flight placeholder. */
export const EARTH_RADIUS = 1000;
export const ORBIT_ALTITUDE = 63; // ≈ 400 km at this scale

export const SPACE_FAR = 400_000;

/** Initial planet rotation, chosen so land sits under the menu camera. */
const EARTH_PHASE = 1.4;

/**
 * A reusable "Earth from orbit" scene: star field, sun, stand-in Earth and lighting.
 * The camera sits near the origin; Earth's centre is below it at (0, -(R + altitude), 0).
 */
export class SpaceView {
  readonly scene = new Scene();
  readonly earth = new EarthLite(EARTH_RADIUS);
  readonly sun = new Sun(150_000, 900, 4.2);
  readonly stars = new Starfield({ count: 7000, radius: 20_000 });
  /** Direction towards the sun, shared by lights and shaders. */
  readonly sunDirection = new Vector3();

  constructor(altitude = ORBIT_ALTITUDE) {
    this.scene.background = new Color(0x000000);
    this.earth.position.set(0, -(EARTH_RADIUS + altitude), 0);
    // Tip the planet so the camera hangs over mid-latitudes instead of the pole.
    this.earth.rotation.set(0.95, 0, 0.25);
    this.earth.syncCentre();

    // Earthshine fill: faint cold light from below, so the shadow side of ships is not pitch black.
    const fill = new HemisphereLight(0x0e1a2c, 0x3a5f94, 1.2);
    fill.position.set(0, 1, 0);
    this.scene.add(this.stars, this.sun, this.earth, fill, new AmbientLight(0x0a0f18, 0.6));
    this.setSun(new Vector3(0.3, -0.045, -0.95));
  }

  setSun(dir: Vector3): void {
    this.sunDirection.copy(dir).normalize();
    this.sun.setDirection(this.sunDirection);
    this.earth.setSunDirection(this.sunDirection);
  }

  /** Keep the infinitely-distant layers centred on the camera. */
  update(camera: PerspectiveCamera, elapsed: number): void {
    this.stars.follow(camera.position);
    this.sun.follow(camera.position);
    this.earth.spin(elapsed, 0.012, EARTH_PHASE);
  }

  dispose(): void {
    disposeTree(this.scene);
  }
}

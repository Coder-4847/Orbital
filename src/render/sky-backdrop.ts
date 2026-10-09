import { Group } from 'three/webgpu';
import { Starfield, skyGain } from './starfield';

/**
 * Everything "at infinity": stars and the Milky Way. The camera is always at the render-space origin, so these never need
 * to follow it. They are depth-tested, so planets and the Sun cover them. (The Sun itself is a real body in SolarSystem.)
 */
export class SkyBackdrop extends Group {
  constructor() {
    super();
    // Stars far beyond the Moon but well inside the camera far plane (1e13 m).
    this.add(new Starfield({ count: 7000, radius: 5e10 }));
  }

  /** Star and Milky Way brightness multiplier (1 = normal). */
  setBrightness(gain: number): void {
    skyGain.value = gain;
  }

  /**
   * Uniformly scale the whole backdrop. Angular sizes are unchanged, so with a standard (non-reversed) depth buffer the
   * sky can be pulled inside a smaller far plane without anyone noticing.
   */
  setDistanceScale(k: number): void {
    this.scale.setScalar(k);
  }
}

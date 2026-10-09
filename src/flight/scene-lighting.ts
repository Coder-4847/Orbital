/**
 * Light and exposure for the flight scene: the Sun as seen through the atmosphere of whichever body the vessel is near
 * (reddening at sunset, shadow in the planet's umbra, none of it in space), the sky and ground ambient, and the camera's
 * adaptation to it all. Works for every body: a bare Moon gets hard sunlight and black shadows, Venus a murky orange.
 */
import { DirectionalLight, HemisphereLight, type Scene, type Vector3 } from 'three/webgpu';
import { ATMOSPHERES } from '../data/atmospheres';
import { bodyDef } from '../data/solar-system';
import type { SkyBackdrop } from '../render/sky-backdrop';
import type { FlightEffects } from './effects';
import type { FlightEnv } from './env';
import { adaptExposure, targetExposure } from './exposure';
import { lightingAt } from './flight-lighting';
import { vdot, vlen, vscale, type V3 } from './math3';

export class FlightLighting {
  sun = new DirectionalLight(0xffffff, 1);
  readonly hemi = new HemisphereLight(0xffffff, 0x444444, 1);
  exposure = 1;
  /** Jump straight to the right exposure on the next update (after a launch, a body change). */
  snap = true;

  constructor(
    private readonly scene: Scene,
    private readonly sky: SkyBackdrop,
    private readonly effects: FlightEffects,
    private readonly exposureUniform: { value: number },
  ) {
    scene.add(this.sun, this.hemi);
  }

  /** Shadow quality 0 (off) to 3, and the half-width (m) of the area around the vessel the shadow map covers. */
  setShadows(quality: number, extent: number): void {
    const on = quality > 0;
    this.sun.castShadow = on;
    if (!on) return;
    const size = [0, 1024, 2048, 4096][Math.min(3, Math.max(0, Math.round(quality)))]!;
    if (this.sun.shadow.mapSize.x !== size) this.replaceSun(size);
    const shadow = this.sun.shadow;
    const cam = shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = 2500;
    cam.updateProjectionMatrix();
    shadow.bias = -0.0004;
    shadow.normalBias = 0.05;
  }

  /**
   * A new sun light for a new shadow map size. Resizing the map of a live light left WebGPU with the old map still bound while
   * the new one was being drawn (a validation error, and a black screen) when MSAA was switched on in the same moment.
   */
  private replaceSun(size: number): void {
    const old = this.sun;
    const next = new DirectionalLight(old.color.getHex(), old.intensity);
    next.position.copy(old.position);
    next.castShadow = true;
    next.shadow.mapSize.set(size, size);
    this.scene.remove(old);
    old.shadow.map?.dispose();
    old.dispose();
    this.scene.add(next);
    this.sun = next;
  }

  /** `position` is the vessel's position relative to the body's centre; `bodyPos` the body's heliocentric position. */
  update(position: V3, env: FlightEnv, bodyId: string, bodyPos: Vector3, dt: number): void {
    const def = bodyDef(bodyId);
    const atmosphere = def.atmosphere ? (ATMOSPHERES[def.atmosphere] ?? null) : null;
    const r = vlen(position);
    const up = vscale(position, 1 / Math.max(r, 1));
    const sunDir = env.sunDir ?? ([0, 1, 0] as V3);
    const sinSun = vdot(up, sunDir);
    const light = lightingAt(r, sinSun, Math.hypot(bodyPos.x, bodyPos.y, bodyPos.z), atmosphere, env.radius, bodyId === 'sun');

    this.sun.position.set(sunDir[0] * 1000, sunDir[1] * 1000, sunDir[2] * 1000);
    this.sun.color.setRGB(light.sun[0], light.sun[1], light.sun[2]);
    this.hemi.position.set(up[0] * 1000, up[1] * 1000, up[2] * 1000);
    this.hemi.color.setRGB(light.sky[0], light.sky[1], light.sky[2]);
    this.hemi.groundColor.setRGB(light.ground[0], light.ground[1], light.ground[2]);
    this.scene.environmentIntensity = 0.04 + 0.35 * light.daylight;
    this.effects.setLight(0.08 + 0.92 * light.daylight);

    const sunDistance = Math.max(Math.hypot(bodyPos.x, bodyPos.y, bodyPos.z), 1);
    const target = targetExposure({
      isStar: bodyId === 'sun',
      atmosphereHeight: atmosphere ? atmosphere.topRadius - atmosphere.radius : 0,
      bodyRadius: env.radius,
      altitude: Math.max(r - env.radius, 0.1),
      sinSun,
      irradianceScale: (1.495978707e11 / sunDistance) ** 2,
    });
    this.exposure = adaptExposure(this.exposure, target, dt, this.snap);
    this.snap = false;
    this.exposureUniform.value = this.exposure;
    this.sky.setBrightness(Math.min(1, 4 / this.exposure));
  }

  dispose(): void {
    this.scene.remove(this.sun, this.hemi);
    this.sun.shadow.map?.dispose();
  }
}

/** Tell every mesh under `roots` whether it casts and receives shadows (new vessels appear when stages separate). */
export function markShadows(on: boolean, ...roots: Array<{ traverse(fn: (o: { isMesh?: boolean; castShadow: boolean; receiveShadow: boolean }) => void): void }>): void {
  for (const root of roots) {
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = on;
        o.receiveShadow = on;
      }
    });
  }
}

import { AdditiveBlending, Group, Sprite, SpriteNodeMaterial, Vector3, type PerspectiveCamera } from 'three/webgpu';
import { exp, float, length, uniform, uv, vec2, vec3 } from 'three/tsl';
import { AU } from '../data/solar-system';
import type { Planet } from './planet';

const SUN_RADIANCE = 900;
const PIXELS = 3.2; // marker diameter on screen

interface Marker {
  planet: Planet;
  sprite: Sprite;
  intensity: ReturnType<typeof uniform>;
}

/**
 * Bodies too small to resolve are drawn as points: Venus and Jupiter shine in the night sky, Neptune is a faint dot,
 * the Sun is a blinding star. A marker's radiance is the body's reflected flux (albedo, phase, distance) spread over a
 * few pixels, so brightness is physically consistent between worlds.
 */
export class BodyMarkers extends Group {
  private readonly markers: Marker[] = [];
  private readonly sunDir = new Vector3();
  private readonly toCamera = new Vector3();

  constructor(planets: Planet[]) {
    super();
    for (const planet of planets) {
      const intensity = uniform(0);
      const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
      const r = length(uv().sub(vec2(0.5, 0.5))).mul(2);
      const glow = exp(r.mul(r).mul(-5)).mul(float(1).sub(r.clamp(0, 1).pow(4)));
      const c = planet.def.color;
      material.colorNode = vec3(Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)).mul(glow).mul(intensity);
      const sprite = new Sprite(material);
      sprite.visible = false;
      sprite.frustumCulled = false;
      sprite.renderOrder = -6;
      this.add(sprite);
      this.markers.push({ planet, sprite, intensity });
    }
  }

  /** Call after the planets have been updated for this frame. */
  update(camera: PerspectiveCamera, viewportHeight: number, cameraWorld: Vector3): void {
    const pixelAngle = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(viewportHeight, 1);
    const sizeRad = PIXELS * pixelAngle;
    const spriteSolidAngle = sizeRad * sizeRad * 0.45; // the gaussian covers roughly 45% of its quad

    for (const m of this.markers) {
      const p = m.planet;
      m.sprite.visible = !p.resolved;
      if (p.resolved) continue;
      const d = Math.max(p.relative.length(), 1);
      m.sprite.position.copy(p.relative);
      m.sprite.scale.setScalar(d * sizeRad);

      const discSolidAngle = Math.PI * (p.radius / d) ** 2;
      let radiance: number;
      if (p.def.kind === 'star') {
        radiance = (SUN_RADIANCE * discSolidAngle) / spriteSolidAngle;
      } else {
        // Reflected sunlight: Lambertian sphere, illuminated fraction from the Sun-body-camera phase angle.
        this.sunDir.copy(p.position).negate().normalize();
        this.toCamera.subVectors(cameraWorld, p.position).normalize();
        const phase = 0.5 * (1 + this.sunDir.dot(this.toCamera));
        const sunDistance = Math.max(p.position.length(), 1);
        const irradiance = 5 * (AU / sunDistance) ** 2;
        radiance = ((p.def.albedo * irradiance) / Math.PI) * phase * (discSolidAngle / spriteSolidAngle) * (2 / 3);
      }
      m.intensity.value = Math.min(radiance, 4000);
    }
  }

  release(): void {
    for (const m of this.markers) m.sprite.material.dispose();
  }
}

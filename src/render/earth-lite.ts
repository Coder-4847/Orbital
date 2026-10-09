import { FrontSide, Group, Mesh, MeshStandardNodeMaterial, SphereGeometry, Vector3, type Node } from 'three/webgpu';
import {
  abs,
  clamp,
  color,
  exp,
  float,
  max,
  mix,
  mx_fractal_noise_float,
  normalWorld,
  normalize,
  positionLocal,
  smoothstep,
  sqrt,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { createAtmosphereMaterial, earthAtmosphere } from './atmosphere';

const LAND_LEVEL = 0.1;
const SEED = vec3(1.7, 4.2, 9.1);

/** Raw continent field: low-frequency shape plus mid-frequency coastline detail. */
const heightField = (p: Node<'vec3'>) =>
  mx_fractal_noise_float(p.mul(1.7).add(SEED), 5, 2.0, 0.5)
    .add(mx_fractal_noise_float(p.mul(7).add(SEED.mul(1.7)), 4, 2.2, 0.5).mul(0.34))
    .add(mx_fractal_noise_float(p.mul(26).add(SEED.mul(2.9)), 3, 2.2, 0.5).mul(0.12));

/**
 * A procedural stand-in Earth used on the menu and flight placeholder: noise continents, ocean glints,
 * clouds, polar ice, night-side city lights and a ray-marched atmosphere. Phase 2 replaces it with the
 * real cubed-sphere terrain; the atmosphere and cloud look carry over as the starting point.
 *
 * World units are arbitrary: `radius` units correspond to Earth's 6371 km.
 */
export class EarthLite extends Group {
  /** Direction *towards* the sun in world space. */
  readonly sunDirection = uniform(new Vector3(0, 0, 1));
  /** Planet centre in world space (read by the atmosphere shader). */
  readonly centre = uniform(new Vector3());

  private readonly surface: Mesh;
  private readonly clouds: Mesh;

  constructor(readonly radius: number) {
    super();
    const metersPerUnit = 6_371_000 / radius;

    this.surface = new Mesh(new SphereGeometry(radius, 256, 128), this.createSurfaceMaterial());
    this.clouds = new Mesh(new SphereGeometry(radius * 1.0022, 192, 96), this.createCloudMaterial());
    const atmo = earthAtmosphere(metersPerUnit, radius, { heightScale: 1.35, sunIntensity: 6, mieScale: 0.3 });
    const shell = new Mesh(new SphereGeometry(atmo.outerRadius, 160, 80), createAtmosphereMaterial(atmo, this.centre, this.sunDirection));
    shell.renderOrder = 10;
    this.clouds.renderOrder = 5;
    this.add(this.surface, this.clouds, shell);
  }

  setSunDirection(dir: Vector3): void {
    this.sunDirection.value.copy(dir).normalize();
  }

  /** Call after moving the group; keeps the shader's idea of the centre in sync. */
  syncCentre(): void {
    this.getWorldPosition(this.centre.value);
  }

  /** Slowly spin the planet; clouds drift a little faster than the ground. */
  spin(seconds: number, rateRadPerSec = 0.012, phase = 0): void {
    this.surface.rotation.y = phase + seconds * rateRadPerSec;
    this.clouds.rotation.y = phase + seconds * rateRadPerSec * 1.18;
  }

  private createSurfaceMaterial(): MeshStandardNodeMaterial {
    const p = normalize(positionLocal);
    const h = heightField(p).toVar();
    const land = smoothstep(LAND_LEVEL - 0.012, LAND_LEVEL + 0.012, h).toVar();
    const elevation = clamp(h.sub(LAND_LEVEL).div(0.55), 0, 1).toVar();
    const lat = abs(p.y).toVar();

    const iceNoise = mx_fractal_noise_float(p.mul(5).add(SEED), 4, 2, 0.5);
    const ice = smoothstep(0.8, 0.9, lat.add(iceNoise.mul(0.07))).toVar();

    const moisture = mx_fractal_noise_float(p.mul(2.3).add(SEED.mul(2.3)), 4, 2, 0.5).toVar();
    const aridBand = exp(lat.sub(0.33).div(0.16).pow(2).negate());
    const desert = smoothstep(-0.02, 0.2, moisture).mul(aridBand);

    const forest = color(0x213f1b);
    const grass = color(0x56662f);
    const sand = color(0xb89763);
    const rock = color(0x645d54);
    const snow = color(0xf3f7fb);

    let ground = mix(forest, grass, smoothstep(0.15, 0.85, lat.add(moisture.mul(0.4))));
    ground = mix(ground, sand, desert);
    ground = mix(ground, rock, smoothstep(0.3, 0.75, elevation));
    ground = mix(ground, snow, max(ice, smoothstep(0.78, 1, elevation)));

    const depth = clamp(float(LAND_LEVEL).sub(h).div(0.4), 0, 1);
    let sea = mix(color(0x2f9cc2), color(0x06377c), sqrt(depth));
    sea = mix(sea, color(0xdfeaf2), ice.mul(0.92));

    // City lights: clustered speckle on land, only visible away from the sun.
    const speckle = smoothstep(0.25, 0.8, mx_fractal_noise_float(p.mul(60).add(SEED), 2, 2.3, 0.5)).pow(2);
    const clusters = smoothstep(0.1, 0.55, mx_fractal_noise_float(p.mul(4.4).add(SEED.mul(3.3)), 4, 2, 0.5));
    const night = float(1).sub(smoothstep(-0.25, 0.0, normalWorld.dot(this.sunDirection)));
    const lights = speckle.mul(clusters).mul(land).mul(float(1).sub(ice)).mul(night);

    const material = new MeshStandardNodeMaterial({ side: FrontSide });
    material.colorNode = vec4(mix(sea, ground, land), 1);
    material.roughnessNode = mix(mix(float(0.16), float(0.88), land), float(0.5), ice);
    material.metalnessNode = float(0);
    material.emissiveNode = color(0xffb866).mul(lights).mul(1.4);
    return material;
  }

  private createCloudMaterial(): MeshStandardNodeMaterial {
    const p = normalize(positionLocal);
    const warp = mx_fractal_noise_float(p.mul(2.1).add(SEED.mul(5)), 3, 2, 0.5);
    const q = p.add(warp.mul(0.32));
    const density = mx_fractal_noise_float(q.mul(3.1).add(SEED.mul(0.4)), 6, 2.1, 0.52).add(0.0);
    const cover = smoothstep(0.1, 0.5, density);

    const material = new MeshStandardNodeMaterial({ transparent: true, depthWrite: false });
    material.colorNode = vec4(1, 1, 1, 1);
    material.opacityNode = cover.mul(0.92);
    material.roughnessNode = float(1);
    material.metalnessNode = float(0);
    return material;
  }
}

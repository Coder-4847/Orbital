import {
  AdditiveBlending,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  Sprite,
  SpriteNodeMaterial,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import { color, exp, float, length, uv, vec2 } from 'three/tsl';

/**
 * The sun: a directional light plus a very bright HDR disc and a soft additive halo placed far along `direction`.
 * Bloom turns the HDR disc into glare. Positions follow the camera so the sun stays at infinity.
 */
export class Sun extends Group {
  readonly light: DirectionalLight;
  readonly direction = new Vector3(0, 0, 1);
  private readonly disc: Mesh;
  private readonly halo: Sprite;

  constructor(private readonly distance: number, discRadius: number, intensity = 4) {
    super();
    this.light = new DirectionalLight(0xfff4e6, intensity);

    this.disc = new Mesh(new SphereGeometry(discRadius, 32, 16), (() => {
      const m = new MeshBasicNodeMaterial();
      m.colorNode = color(0xfff1d6).mul(60);
      return m;
    })());

    const haloMaterial = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const r = length(uv().sub(vec2(0.5, 0.5))).mul(2);
    const glow = exp(r.mul(-5.5)).mul(0.9).add(exp(r.mul(-1.6)).mul(0.14)).mul(float(1).sub(r.clamp(0, 1).pow(4)));
    haloMaterial.colorNode = color(0xffe6c4).mul(glow).mul(3);
    this.halo = new Sprite(haloMaterial);
    this.halo.scale.setScalar(discRadius * 22);

    this.disc.renderOrder = -5;
    this.halo.renderOrder = -4;
    this.add(this.disc, this.halo, this.light, this.light.target);
    this.setDirection(this.direction);
  }

  /** Set the direction *towards* the sun (need not be normalised). */
  setDirection(dir: Vector3): void {
    this.direction.copy(dir).normalize();
    this.disc.position.copy(this.direction).multiplyScalar(this.distance);
    this.halo.position.copy(this.disc.position);
    this.light.position.copy(this.direction);
    this.light.target.position.set(0, 0, 0);
  }

  follow(position: Vector3): void {
    this.position.copy(position);
  }
}

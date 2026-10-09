import { Matrix4, Quaternion, Vector3, type Node } from 'three/webgpu';
import { float, mix, mx_fractal_noise_float, normalize, smoothstep, uniform, vec3, vec4 } from 'three/tsl';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/**
 * A procedural cloud deck on a thin spherical shell. Coverage is a function of body-fixed direction (clouds are glued
 * to the planet's rotation and drift with a slow wind), so it needs no mesh, has no LOD seams, and holds up from orbit
 * down to the ground. It is evaluated in the atmosphere pass at the single point where each view ray crosses the shell.
 */
export class CloudLayer {
  /** Inertial -> body-fixed rotation (4x4 for convenience). */
  private readonly bodyInverse = uniform(new Matrix4());
  /** Wind offset in noise space; advances with time. */
  private readonly wind = uniform(new Vector3());
  /** Global cloudiness 0..1. */
  readonly coverage = uniform(0.42);

  private readonly inverse = new Quaternion();

  constructor(readonly altitude: number) {}

  /** Call every frame. `elapsed` is seconds (real or simulated); clouds move ~15 m/s relative to the ground. */
  update(orientation: Quaternion, elapsed: number): void {
    this.inverse.copy(orientation).invert();
    this.bodyInverse.value.makeRotationFromQuaternion(this.inverse);
    this.wind.value.set(elapsed * 2.3e-6, 0, elapsed * 1.1e-6);
  }

  /**
   * Cloud opacity 0..1 along unit direction `dir` (world axes) from the planet centre.
   * `detail` (0..1) fades in the fine octaves as the viewer gets close, so distant clouds do not shimmer.
   */
  alpha(dir: V3, detail: F): F {
    const dirBF = normalize(this.bodyInverse.mul(vec4(dir, 0)).xyz) as V3;
    const w = this.wind as unknown as V3;
    const warp = mx_fractal_noise_float(dirBF.mul(3.1).add(w.mul(0.4)), 3, 2, 0.5) as F;
    const q = dirBF.add(vec3(warp, warp.mul(0.7), warp.mul(-0.8)).mul(0.07)) as V3;
    const large = mx_fractal_noise_float(q.mul(2.6).add(w), 4, 2, 0.55) as F; // weather systems, ~2500 km
    const mid = mx_fractal_noise_float(q.mul(19).add(w.mul(1.5)), 4, 2.1, 0.5) as F; // cloud fields, ~330 km
    const puffs = mx_fractal_noise_float(q.mul(210).add(w.mul(4)), 3, 2.2, 0.5) as F; // individual cumulus, ~30 km
    const edges = mx_fractal_noise_float(q.mul(4600).add(w.mul(9)), 3, 2.2, 0.5) as F; // ragged edges, ~1.4 km
    const shape = large.mul(1.15).add(mid.mul(0.42)).add(puffs.mul(0.22).mul(detail.mul(0.6).add(0.4))).add(edges.mul(0.1).mul(detail)) as F;
    const bias = this.coverage.sub(0.5).mul(1.1).sub(0.06) as F;
    // Edges sharpen as the viewer gets close, where individual clouds should read as clouds rather than haze.
    return smoothstep(-0.02, float(0.5).sub(detail.mul(0.2)), shape.add(bias)) as F;
  }

  /**
   * Self-shadowing: compare opacity here with opacity a little towards the sun. Thicker cloud sunward means this point
   * is in shade; thinner means it is a lit edge. `dirC` is the unit direction of the point, `sunDir` towards the sun.
   */
  selfShadow(dirC: V3, sunDir: V3, a: F, detail: F): F {
    const tangent = normalize(sunDir.sub(dirC.mul(dirC.dot(sunDir)))) as V3;
    const aSun = this.alpha(normalize(dirC.add(tangent.mul(0.00028))) as V3, detail);
    return smoothstep(-0.35, 0.45, a.sub(aSun)).mul(0.8).add(0.35) as F;
  }

  /** Brightness variation across the deck (denser = brighter tops): cheap fake of self-shadowing. */
  static shading(alpha: F): F {
    return mix(float(0.78), float(1.12), smoothstep(0.1, 1.0, alpha)) as F;
  }
}

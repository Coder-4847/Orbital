/**
 * Engine plumes: two nested additive shells (a hot white core inside an orange sheath) whose shape follows ambient pressure:
 * short, tight and bright with shock diamonds at sea level, long, wide and faint in vacuum. The shells fade where they are seen
 * edge-on, so the plume reads as glowing gas rather than a solid cone; flicker and the streaming of the gas come from a shader
 * time uniform. The plume is a child of the engine part, hanging along local -Y from the bell exit.
 */
import { AdditiveBlending, DoubleSide, Group, LatheGeometry, Mesh, MeshBasicNodeMaterial, Vector2, type BufferGeometry, type Node } from 'three/webgpu';
import { abs, cos, dot, float, mix, normalView, normalize, positionLocal, positionView, pow, sin, uniform, vec3 } from 'three/tsl';

type F = Node<'float'>;

export class PlumeFactory {
  private readonly geometry: BufferGeometry;
  /** Seconds, driving the flicker of every plume. */
  readonly time = uniform(0);
  private readonly materials: MeshBasicNodeMaterial[] = [];

  constructor() {
    // Profile from the nozzle (y = 0, radius 1) to the tip (y = -1): a slight bulge just below the bell, then a long taper.
    const profile: Vector2[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      profile.push(new Vector2(Math.max(0.0001, (1 + 0.5 * t) * Math.pow(1 - t, 0.85)), -t));
    }
    this.geometry = new LatheGeometry(profile, 32);
  }

  private material(core: boolean, intensity: F, sea: F, phase: number): MeshBasicNodeMaterial {
    const t = positionLocal.y.negate().clamp(0, 1) as F; // 0 at the nozzle .. 1 at the tip
    const time = this.time as unknown as F;
    const flicker = float(0.88).add(sin(time.mul(55).add(phase)).mul(0.07)).add(sin(time.mul(23.7).add(phase * 1.7)).mul(0.05)) as F;
    // Bright knots streaming down the plume, and standing shock diamonds where the air squeezes the jet.
    const stream = float(1).add(sin(t.mul(34).sub(time.mul(46)).add(phase)).mul(0.09)) as F;
    const diamonds = float(1).add(pow(cos(t.mul(Math.PI * 9)).mul(0.5).add(0.5), 4).mul(sea).mul(core ? 1.6 : 0.5).mul(float(1).sub(t))) as F;
    const hot = core ? vec3(1.0, 0.95, 0.88).mul(14) : vec3(1.0, 0.5, 0.14).mul(5);
    const cool = core ? vec3(1.0, 0.7, 0.35).mul(5) : vec3(1.0, 0.28, 0.06).mul(1.2);
    const colour = mix(hot, cool, t).mul(flicker).mul(stream).mul(diamonds);
    // Thick where the view passes through the middle of the shell, vanishing at its silhouette.
    const facing = abs(dot(normalize(normalView), normalize(positionView))) as F;
    const alpha = pow(float(1).sub(t), core ? 1.8 : 1.3).mul(pow(facing, core ? 1.2 : 2)).mul(intensity).mul(core ? 1 : 0.7) as F;
    const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
    m.colorNode = colour;
    m.opacityNode = alpha;
    this.materials.push(m);
    return m;
  }

  /** A plume object plus the function that updates its shape: `burn` 0..1, `pressure` as a fraction of sea level, bell radius in metres. */
  create(): Plume {
    const intensity = uniform(1);
    const sea = uniform(1);
    const phase = Math.random() * 6;
    const outer = new Mesh(this.geometry, this.material(false, intensity as unknown as F, sea as unknown as F, phase));
    const inner = new Mesh(this.geometry, this.material(true, intensity as unknown as F, sea as unknown as F, phase + 2));
    for (const m of [outer, inner]) {
      m.frustumCulled = false;
      m.renderOrder = 6;
    }
    const group = new Group();
    group.add(outer, inner);
    group.visible = false;
    return new Plume(group, outer, inner, intensity as unknown as { value: number }, sea as unknown as { value: number });
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
  }
}

export class Plume {
  constructor(
    readonly group: Group,
    private readonly outer: Mesh,
    private readonly inner: Mesh,
    private readonly intensity: { value: number },
    private readonly sea: { value: number },
  ) {}

  /** `bell` is the exit radius (m). */
  update(burn: number, pressureRatio: number, bell: number): void {
    if (burn < 0.01) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const p = Math.min(1, Math.max(0, pressureRatio));
    const vac = 1 - p;
    const length = bell * (11 + 26 * vac) * (0.45 + 0.55 * burn);
    const width = bell * (1.0 + 1.5 * vac) * (0.7 + 0.3 * burn);
    this.outer.scale.set(width, length, width);
    this.inner.scale.set(width * 0.5, length * 0.6, width * 0.5);
    this.sea.value = p;
    this.intensity.value = (0.9 + 0.6 * p) * Math.min(1, 0.3 + burn);
  }
}

/**
 * Engine plumes: two nested additive cones (a hot white core inside an orange sheath) whose shape follows ambient pressure:
 * short, fat and bright at sea level, long and wide but faint in vacuum. Flicker is a shader time uniform. The plume is a child
 * of the engine part, hanging along local -Y from the bell exit.
 */
import { AdditiveBlending, ConeGeometry, DoubleSide, Group, Mesh, MeshBasicNodeMaterial, type BufferGeometry, type Node } from 'three/webgpu';
import { float, mix, positionLocal, pow, sin, uniform, vec3 } from 'three/tsl';

export class PlumeFactory {
  private readonly geometry: BufferGeometry;
  /** Seconds, driving the flicker of every plume. */
  readonly time = uniform(0);
  private readonly materials: MeshBasicNodeMaterial[] = [];

  constructor() {
    const cone = new ConeGeometry(1, 1, 28, 1, true);
    cone.rotateX(Math.PI); // apex down
    cone.translate(0, -0.5, 0); // base at y = 0 (the nozzle), apex at y = -1
    this.geometry = cone;
  }

  private material(core: boolean, intensity: Node<'float'>, phase: number): MeshBasicNodeMaterial {
    const t = positionLocal.y.negate(); // 0 at the nozzle .. 1 at the tip
    const flicker = float(0.88).add(sin(this.time.mul(55).add(phase)).mul(0.07)).add(sin(this.time.mul(23.7).add(phase * 1.7)).mul(0.05));
    const hot = core ? vec3(1.0, 0.95, 0.88).mul(14) : vec3(1.0, 0.5, 0.14).mul(5);
    const cool = core ? vec3(1.0, 0.7, 0.35).mul(5) : vec3(1.0, 0.28, 0.06).mul(1.2);
    const colour = mix(hot, cool, t.clamp(0, 1)).mul(flicker);
    const alpha = pow(float(1).sub(t.clamp(0, 1)), core ? 1.8 : 1.3).mul(intensity).mul(core ? 1 : 0.55);
    const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
    m.colorNode = colour;
    m.opacityNode = alpha;
    this.materials.push(m);
    return m;
  }

  /** A plume object plus the function that updates its shape: `burn` 0..1, `pressure` as a fraction of sea level, bell radius in metres. */
  create(): Plume {
    const intensity = uniform(1);
    const node = intensity as unknown as Node<'float'>;
    const outer = new Mesh(this.geometry, this.material(false, node, Math.random() * 6));
    const inner = new Mesh(this.geometry, this.material(true, node, Math.random() * 6));
    for (const m of [outer, inner]) {
      m.frustumCulled = false;
      m.renderOrder = 6;
    }
    const group = new Group();
    group.add(outer, inner);
    group.visible = false;
    return new Plume(group, outer, inner, intensity as unknown as { value: number });
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
  ) {}

  /** `bell` is the exit radius (m). */
  update(burn: number, pressureRatio: number, bell: number): void {
    if (burn < 0.01) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const vac = 1 - Math.min(1, Math.max(0, pressureRatio));
    const length = bell * (9 + 26 * vac) * (0.45 + 0.55 * burn);
    const width = bell * (1.05 + 1.1 * vac) * (0.7 + 0.3 * burn);
    this.outer.scale.set(width, length, width);
    this.inner.scale.set(width * 0.45, length * 0.55, width * 0.45);
    this.intensity.value = (0.55 + 0.45 * pressureRatio + 0.35) * Math.min(1, 0.3 + burn);
  }
}

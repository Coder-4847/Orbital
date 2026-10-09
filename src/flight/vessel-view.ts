/**
 * The 3D side of vessels: one group per vessel in the planet-centred inertial frame, made of the same procedural part meshes the
 * Hangar uses, plus engine plumes, parachute canopies and folding landing legs. Everything is placed relative to the camera
 * (floating origin), so positions stay small however far from the planet's centre the vessel is.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Group, LineBasicNodeMaterial, LineSegments, Mesh, MeshStandardNodeMaterial, Scene, SphereGeometry, Vector3 } from 'three/webgpu';
import type { PartFactory } from '../builder/part-meshes';
import { CHUTE_AREA } from './aero';
import type { Plume, PlumeFactory } from './plume';
import { pressureRatio } from './propulsion';
import { vsub, type Quat, type V3 } from './math3';
import type { FlightPart, Vessel } from './vessel';

interface PartNode {
  part: FlightPart;
  group: Group;
  plume?: Plume;
  canopy?: Mesh;
  lines?: LineSegments;
}

const rotationOf = (g: Group, p: { yaw: number; flip: boolean }): void => {
  g.rotation.order = 'YXZ';
  g.rotation.set(p.flip ? Math.PI : 0, p.yaw, 0);
};

export class VesselView {
  readonly group = new Group();
  private readonly nodes = new Map<string, PartNode>();

  constructor(
    readonly vessel: Vessel,
    private readonly factory: PartFactory,
    private readonly plumes: PlumeFactory,
    private readonly canopy: { geometry: SphereGeometry; material: MeshStandardNodeMaterial; lineMaterial: LineBasicNodeMaterial },
  ) {}

  /** Position the vessel and its parts. `rel` is the vessel's centre of mass relative to the camera (m, inertial axes). */
  update(rel: Vector3, q: Quat, air: { pressure: number }): void {
    const v = this.vessel;
    this.group.position.copy(rel);
    this.group.quaternion.set(q[0], q[1], q[2], q[3]);
    const live = new Set(v.parts.map((p) => p.id));
    for (const [id, node] of this.nodes) {
      if (!live.has(id)) {
        this.group.remove(node.group);
        this.nodes.delete(id);
      }
    }
    const ratio = pressureRatio(air.pressure);
    for (const p of v.parts) {
      let node = this.nodes.get(p.id);
      if (!node) {
        node = { part: p, group: this.factory.create(p.def, p.id) };
        if (p.def.engine) {
          node.plume = this.plumes.create();
          node.plume.group.position.set(0, -p.def.height / 2, 0);
          node.group.add(node.plume.group);
        }
        this.group.add(node.group);
        this.nodes.set(p.id, node);
      }
      node.part = p;
      const local = vsub(p.pos, v.mass.com);
      node.group.position.set(local[0], local[1], local[2]);
      rotationOf(node.group, p);
      if (node.plume) node.plume.update(p.burn, ratio, p.def.radius * 0.9);
      if (p.def.look === 'leg') node.group.rotation.z = (1 - p.leg) * 1.5;
      this.updateChute(node, p, v);
    }
  }

  private updateChute(node: PartNode, p: FlightPart, v: Vessel): void {
    const out = p.chute === 'deploying' || p.chute === 'deployed';
    if (!out) {
      if (node.canopy) {
        node.canopy.visible = false;
        if (node.lines) node.lines.visible = false;
      }
      return;
    }
    if (!node.canopy) {
      node.canopy = new Mesh(this.canopy.geometry, this.canopy.material);
      node.canopy.frustumCulled = false;
      this.group.add(node.canopy);
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(8 * 3), 3));
      node.lines = new LineSegments(geo, this.canopy.lineMaterial);
      node.lines.frustumCulled = false;
      this.group.add(node.lines);
    }
    const area = (CHUTE_AREA[p.def.id] ?? 20) * Math.max(0.05, p.chuteDeploy) ** 1.5;
    const radius = Math.sqrt(area / Math.PI);
    const rope = Math.max(3, radius * 1.8);
    // The canopy trails upwind of the part, along the airflow, dome facing the wind.
    const wind = v.tele.airflow;
    const anchor = vsub(p.pos, v.mass.com);
    const centre: V3 = [anchor[0] - wind[0] * rope, anchor[1] - wind[1] * rope, anchor[2] - wind[2] * rope];
    node.canopy.visible = true;
    node.canopy.position.set(centre[0], centre[1], centre[2]);
    node.canopy.scale.setScalar(radius);
    node.canopy.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(-wind[0], -wind[1], -wind[2]));
    // Rope lines from the part to four points on the canopy rim.
    const arr = (node.lines!.geometry.getAttribute('position') as BufferAttribute).array as Float32Array;
    const n = new Vector3(-wind[0], -wind[1], -wind[2]);
    const a = new Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
    const b = new Vector3().crossVectors(n, a);
    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2;
      const rim = new Vector3(...centre).addScaledVector(a, Math.cos(ang) * radius).addScaledVector(b, Math.sin(ang) * radius);
      arr.set([anchor[0], anchor[1], anchor[2], rim.x, rim.y, rim.z], i * 6);
    }
    (node.lines!.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    node.lines!.visible = true;
  }

  dispose(): void {
    for (const node of this.nodes.values()) node.lines?.geometry.dispose();
    this.nodes.clear();
  }
}

/** Manages the views of every vessel in the world and the resources they share. */
export class VesselViews {
  readonly root = new Group();
  private readonly views = new Map<number, VesselView>();
  private readonly canopy = {
    geometry: new SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    material: new MeshStandardNodeMaterial({ color: 0xf1f1ee, roughness: 0.8, metalness: 0, side: DoubleSide }),
    lineMaterial: new LineBasicNodeMaterial({ color: 0xd9d9d0 }),
  };

  constructor(
    scene: Scene,
    readonly factory: PartFactory,
    private readonly plumes: PlumeFactory,
  ) {
    scene.add(this.root);
  }

  /** Bring the views up to date. `relative(v)` gives each vessel's centre of mass relative to the camera. */
  sync(vessels: Vessel[], relative: (v: Vessel) => Vector3): void {
    const live = new Set(vessels.map((v) => v.id));
    for (const [id, view] of this.views) {
      if (!live.has(id)) {
        this.root.remove(view.group);
        view.dispose();
        this.views.delete(id);
      }
    }
    for (const v of vessels) {
      let view = this.views.get(v.id);
      if (!view) {
        view = new VesselView(v, this.factory, this.plumes, this.canopy);
        this.views.set(v.id, view);
        this.root.add(view.group);
      }
      view.update(relative(v), v.q, { pressure: v.tele.pressure });
    }
  }

  dispose(): void {
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
    this.canopy.geometry.dispose();
    this.canopy.material.dispose();
    this.canopy.lineMaterial.dispose();
    this.factory.dispose();
    this.plumes.dispose();
  }
}


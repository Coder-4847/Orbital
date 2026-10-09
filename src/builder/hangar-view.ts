/**
 * The 3D side of the Hangar: keeps scene objects in step with the craft model, draws the placement ghost, the selection and
 * the centre-of-mass / centre-of-pressure markers, and answers "what is under the pointer".
 */
import { BoxHelper, Group, Mesh, MeshBasicNodeMaterial, Raycaster, SphereGeometry, Vector3, type Object3D } from 'three/webgpu';
import { craftBounds, type Craft, type V3 } from './craft';
import { PartFactory, type GhostState } from './part-meshes';
import { partDef } from './part-library';

/** A part about to be placed: where and how it will sit, in the craft frame. */
export interface GhostPart {
  def: string;
  pos: V3;
  yaw: number;
  flip: boolean;
}

export interface Pick {
  partId: string;
  /** Hit point in the craft frame (the frame used by the model). */
  point: V3;
}

const tag = (o: Object3D): string | null => {
  for (let cur: Object3D | null = o; cur; cur = cur.parent) if (typeof cur.userData.partId === 'string' && cur.userData.partId !== '') return cur.userData.partId as string;
  return null;
};

export class CraftView {
  /** Everything in the craft frame, lifted so the lowest point rests on the floor. */
  readonly root = new Group();
  private readonly views = new Map<string, Group>();
  private readonly ghosts = new Group();
  private readonly outlines: BoxHelper[] = [];
  private readonly markers = new Group();
  private readonly com: Mesh;
  private readonly cop: Mesh;
  private readonly raycaster = new Raycaster();
  private readonly tmp = new Vector3();

  constructor(private readonly factory: PartFactory) {
    this.root.add(this.ghosts, this.markers);
    const marker = (color: number, radius: number) => {
      const m = new Mesh(new SphereGeometry(radius, 20, 12), new MeshBasicNodeMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
      m.renderOrder = 20;
      m.visible = false;
      this.markers.add(m);
      return m;
    };
    this.com = marker(0xffd166, 0.22);
    this.cop = marker(0x6cc6ff, 0.18);
  }

  /** Bring the scene objects up to date with `craft`. Returns the floor offset applied to the root. */
  sync(craft: Craft): number {
    const live = new Set(craft.parts.map((p) => p.id));
    for (const [id, g] of this.views) {
      if (!live.has(id)) {
        this.root.remove(g);
        this.views.delete(id);
      }
    }
    for (const p of craft.parts) {
      let g = this.views.get(p.id);
      if (!g || g.userData.def !== p.def) {
        if (g) this.root.remove(g);
        g = this.factory.create(partDef(p.def), p.id);
        g.userData.def = p.def;
        this.root.add(g);
        this.views.set(p.id, g);
      }
      this.place(g, p);
    }
    const lift = craft.parts.length > 0 ? -craftBounds(craft).min[1] : 0;
    this.root.position.y = lift;
    return lift;
  }

  private place(g: Group, p: { pos: V3; yaw: number; flip: boolean }): void {
    g.position.set(p.pos[0], p.pos[1], p.pos[2]);
    g.rotation.order = 'YXZ';
    g.rotation.set(p.flip ? Math.PI : 0, p.yaw, 0);
  }

  /** Show translucent previews of parts about to be placed (already positioned in the craft frame). */
  showGhosts(parts: GhostPart[], state: GhostState): void {
    this.clearGhosts();
    for (const p of parts) {
      const g = this.factory.create(partDef(p.def), '', state);
      this.place(g, p);
      this.ghosts.add(g);
    }
  }

  clearGhosts(): void {
    for (const c of [...this.ghosts.children]) this.ghosts.remove(c);
  }

  /** Outline the selected parts. */
  setSelection(ids: string[]): void {
    for (const o of this.outlines) {
      this.root.remove(o);
      o.dispose();
    }
    this.outlines.length = 0;
    for (const id of ids) {
      const g = this.views.get(id);
      if (!g) continue;
      const box = new BoxHelper(g, 0x9ad7ff);
      this.root.add(box);
      this.outlines.push(box);
    }
  }

  /** Keep outlines glued to their parts after the model changed. */
  refreshSelection(): void {
    for (const o of this.outlines) o.update();
  }

  setMarkers(com: V3 | null, cop: V3 | null, visible: boolean): void {
    this.com.visible = visible && com !== null;
    this.cop.visible = visible && cop !== null;
    if (com) this.com.position.set(com[0], com[1], com[2]);
    if (cop) this.cop.position.set(cop[0], cop[1], cop[2]);
  }

  /** First part under the pointer ray (a Raycaster already aimed by the caller through `aim`). */
  pick(aim: (r: Raycaster) => void): Pick | null {
    aim(this.raycaster);
    this.root.updateMatrixWorld(true);
    const solids = [...this.views.values()];
    const hit = this.raycaster.intersectObjects(solids, true).find((h) => tag(h.object) !== null);
    if (!hit) return null;
    const local = this.tmp.copy(hit.point).sub(this.root.position);
    return { partId: tag(hit.object)!, point: [local.x, local.y, local.z] };
  }

  /** The pointer ray in the craft frame. */
  rayInCraftFrame(aim: (r: Raycaster) => void): { origin: V3; dir: V3 } {
    aim(this.raycaster);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    return { origin: [o.x - this.root.position.x, o.y - this.root.position.y, o.z - this.root.position.z], dir: [d.x, d.y, d.z] };
  }

  viewOf(id: string): Group | undefined {
    return this.views.get(id);
  }

  dispose(): void {
    this.setSelection([]);
    this.clearGhosts();
    for (const m of [this.com, this.cop]) {
      m.geometry.dispose();
      (m.material as MeshBasicNodeMaterial).dispose();
    }
    this.factory.dispose();
  }
}


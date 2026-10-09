/**
 * Procedural part meshes with PBR materials (no model files). Every part is built in its local frame: origin at the centre of
 * its bounding cylinder, +Y up; side-mounted parts extend along +X from their attachment point. A `PartFactory` owns the shared
 * geometry and materials, builds one template per part and hands out cheap clones; dispose it when the scene ends.
 */
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardNodeMaterial,
  SphereGeometry,
  Shape,
  TorusGeometry,
  Vector2,
  type Material,
} from 'three/webgpu';
import { RADIAL_DECOUPLER_LENGTH } from './craft';
import type { PartDef } from './part-types';

type MaterialKey = 'white' | 'steel' | 'dark' | 'copper' | 'gold' | 'glass' | 'accent' | 'solar' | 'orange' | 'ablator' | 'red';

const MATERIALS: Record<MaterialKey, { color: number; metalness: number; roughness: number; emissive?: number }> = {
  white: { color: 0xe8ecf1, metalness: 0.15, roughness: 0.42 },
  steel: { color: 0xa4acb7, metalness: 0.85, roughness: 0.36 },
  dark: { color: 0x22262d, metalness: 0.6, roughness: 0.5 },
  copper: { color: 0xb97b45, metalness: 1, roughness: 0.34 },
  gold: { color: 0xd8b25a, metalness: 1, roughness: 0.3 },
  glass: { color: 0x1f3247, metalness: 0.9, roughness: 0.12 },
  accent: { color: 0x9ad7ff, metalness: 0.2, roughness: 0.4, emissive: 0x2b6f99 },
  solar: { color: 0x14284f, metalness: 0.55, roughness: 0.28 },
  orange: { color: 0xe07a3a, metalness: 0.2, roughness: 0.5 },
  ablator: { color: 0x4b3a2c, metalness: 0.1, roughness: 0.85 },
  red: { color: 0xc4443c, metalness: 0.2, roughness: 0.5 },
};

export type GhostState = 'ok' | 'bad';

const SEGMENTS = 40;

/** Lathe of a (radius, y) profile around the Y axis, y measured from the part's centre. */
const lathe = (profile: Array<[number, number]>): BufferGeometry => new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), SEGMENTS);

export class PartFactory {
  private readonly materials = new Map<MaterialKey, MeshStandardNodeMaterial>();
  private readonly ghostMaterials = new Map<GhostState, MeshStandardNodeMaterial>();
  private readonly geometries: BufferGeometry[] = [];
  private readonly templates = new Map<string, Group>();

  private mat(key: MaterialKey): MeshStandardNodeMaterial {
    let m = this.materials.get(key);
    if (!m) {
      const spec = MATERIALS[key];
      m = new MeshStandardNodeMaterial({ color: new Color(spec.color), metalness: spec.metalness, roughness: spec.roughness, side: key === 'solar' ? DoubleSide : undefined });
      if (spec.emissive !== undefined) m.emissive = new Color(spec.emissive);
      this.materials.set(key, m);
    }
    return m;
  }

  private ghostMat(state: GhostState): MeshStandardNodeMaterial {
    let m = this.ghostMaterials.get(state);
    if (!m) {
      m = new MeshStandardNodeMaterial({ color: new Color(state === 'ok' ? 0x7fe3a8 : 0xff7b73), metalness: 0, roughness: 0.6, transparent: true, opacity: 0.5, depthWrite: false });
      m.emissive = new Color(state === 'ok' ? 0x1d6b43 : 0x7a2420);
      this.ghostMaterials.set(state, m);
    }
    return m;
  }

  private add(group: Group, geometry: BufferGeometry, key: MaterialKey, x = 0, y = 0, z = 0): Mesh {
    this.geometries.push(geometry);
    const mesh = new Mesh(geometry, this.mat(key));
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }

  /** A part ready to place: a clone of the template (shared geometry), tagged with `partId` for picking. */
  create(def: PartDef, partId = '', ghost?: GhostState): Group {
    let template = this.templates.get(def.id);
    if (!template) {
      template = this.build(def);
      this.templates.set(def.id, template);
    }
    const group = template.clone();
    group.userData.partId = partId;
    if (ghost) group.traverse((o) => ((o as Mesh).isMesh ? ((o as Mesh).material = this.ghostMat(ghost) as Material) : undefined));
    return group;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    for (const m of this.ghostMaterials.values()) m.dispose();
    this.geometries.length = 0;
    this.materials.clear();
    this.ghostMaterials.clear();
    this.templates.clear();
  }

  // ------------------------------------------------------------------ per-look builders

  private build(d: PartDef): Group {
    const g = new Group();
    const h = d.height;
    const r = d.radius;
    switch (d.look) {
      case 'tank': {
        this.add(g, new CylinderGeometry(r, r, h, SEGMENTS), 'white');
        for (const y of [h / 2 - 0.04 * Math.min(h, 2), -h / 2 + 0.04 * Math.min(h, 2)]) this.add(g, new CylinderGeometry(r * 1.012, r * 1.012, 0.05, SEGMENTS), 'steel', 0, y, 0);
        if (h > 1.5) this.add(g, new CylinderGeometry(r * 1.006, r * 1.006, 0.12, SEGMENTS), d.propellant?.kind === 'xenon' ? 'accent' : 'orange', 0, h * 0.2, 0);
        break;
      }
      case 'pod': {
        const top = (d.topSize ?? d.radius * 2) / 2;
        const bottom = (d.bottomSize ?? d.radius * 2) / 2;
        this.add(g, lathe([[0, -h / 2], [bottom * 0.92, -h / 2], [bottom, -h / 2 + 0.06 * h], [top * 1.15, h * 0.18], [top * 0.55, h * 0.42], [top, h / 2 - 0.02], [top, h / 2], [0, h / 2]]), 'white');
        this.add(g, new CylinderGeometry(bottom * 0.99, bottom * 0.99, 0.08, SEGMENTS), 'gold', 0, -h / 2 + 0.05, 0);
        const window = this.add(g, new BoxGeometry(0.34 * top * 2, 0.22 * h, 0.1), 'glass', 0, h * 0.1, top * 0.88);
        window.rotation.x = -0.22;
        break;
      }
      case 'probe': {
        this.add(g, new CylinderGeometry(r, r, h, SEGMENTS), 'steel');
        this.add(g, new CylinderGeometry(r * 0.55, r * 0.55, 0.06, SEGMENTS), 'accent', 0, h / 2, 0);
        this.add(g, new CylinderGeometry(0.015, 0.015, 0.6, 8), 'dark', r * 0.5, h / 2 + 0.3, 0);
        break;
      }
      case 'engine':
      case 'ion':
        this.buildEngine(g, d);
        break;
      case 'solid': {
        this.add(g, new CylinderGeometry(r, r, h * 0.86, SEGMENTS), 'white', 0, h * 0.07, 0);
        this.add(g, lathe([[0, h / 2], [r * 0.4, h / 2 - 0.03 * h], [r * 0.95, h / 2 - 0.14 * h], [r, h / 2 - 0.14 * h]]), 'red');
        this.add(g, new CylinderGeometry(r * 1.01, r * 1.01, 0.16, SEGMENTS), 'dark', 0, h * 0.2, 0);
        this.add(g, lathe([[r * 0.3, -h / 2], [r * 0.62, -h / 2 + 0.2], [r * 0.5, -h / 2 + 0.3]]), 'copper');
        this.add(g, new CylinderGeometry(r * 0.9, r * 0.9, 0.18, SEGMENTS), 'steel', 0, -h / 2 + 0.3, 0);
        break;
      }
      case 'cone': {
        const pts: Array<[number, number]> = [[0, h / 2]];
        for (let i = 1; i <= 14; i++) {
          const t = i / 14;
          pts.push([r * Math.pow(Math.sin((t * Math.PI) / 2), 0.9), h / 2 - t * h]);
        }
        this.add(g, lathe(pts), 'white');
        break;
      }
      case 'fairing': {
        const base = h * 0.3;
        const pts: Array<[number, number]> = [[0, h / 2]];
        for (let i = 1; i <= 16; i++) {
          const t = i / 16;
          pts.push([r * Math.pow(Math.sin((t * Math.PI) / 2), 0.8), h / 2 - t * (h - base)]);
        }
        pts.push([r, -h / 2]);
        this.add(g, lathe(pts), 'white');
        this.add(g, new CylinderGeometry(r * 1.01, r * 1.01, 0.1, SEGMENTS), 'dark', 0, -h / 2 + base + 0.05, 0);
        break;
      }
      case 'adapter': {
        const rt = d.radiusTop ?? r;
        const rb = d.radiusBottom ?? r;
        this.add(g, new CylinderGeometry(rt, rb, h, SEGMENTS), 'steel');
        this.add(g, new CylinderGeometry(rt * 1.01, rt * 1.01, 0.04, SEGMENTS), 'dark', 0, h / 2 - 0.02, 0);
        this.add(g, new CylinderGeometry(rb * 1.01, rb * 1.01, 0.04, SEGMENTS), 'dark', 0, -h / 2 + 0.02, 0);
        break;
      }
      case 'decoupler': {
        if (d.surface) {
          this.add(g, new BoxGeometry(RADIAL_DECOUPLER_LENGTH, h, 0.26), 'dark', RADIAL_DECOUPLER_LENGTH / 2, 0, 0);
          this.add(g, new BoxGeometry(0.06, h * 1.1, 0.3), 'accent', RADIAL_DECOUPLER_LENGTH * 0.5, 0, 0);
        } else if (h > 0.5) {
          this.add(g, new CylinderGeometry(r * 0.98, r * 0.98, h, SEGMENTS), 'steel');
          this.add(g, new CylinderGeometry(r, r, 0.06, SEGMENTS), 'dark', 0, h / 2 - 0.03, 0);
          this.add(g, new CylinderGeometry(r, r, 0.06, SEGMENTS), 'dark', 0, -h / 2 + 0.03, 0);
        } else {
          this.add(g, new CylinderGeometry(r, r, h, SEGMENTS), 'dark');
          this.add(g, new CylinderGeometry(r * 1.01, r * 1.01, 0.04, SEGMENTS), 'accent', 0, 0, 0);
        }
        break;
      }
      case 'fin': {
        const shape = new Shape();
        shape.moveTo(0, -h / 2);
        shape.lineTo(r, -h / 2 + h * 0.22);
        shape.lineTo(r, h / 2 - h * 0.34);
        shape.lineTo(0, h / 2);
        shape.closePath();
        const geo = new ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
        geo.translate(0, 0, -0.025);
        this.add(g, geo, d.control ? 'steel' : 'white');
        if (d.control) this.add(g, new BoxGeometry(r * 0.35, h * 0.55, 0.07), 'accent', r * 0.82, -h * 0.05, 0);
        break;
      }
      case 'leg': {
        const strut = new CylinderGeometry(0.035, 0.045, Math.hypot(r * 1.6, h), 10);
        const m = this.add(g, strut, 'steel', r * 0.8, 0, 0);
        m.rotation.z = Math.atan2(r * 1.6, h);
        this.add(g, new CylinderGeometry(r * 0.55, r * 0.6, 0.06, 20), 'dark', r * 1.6, -h / 2, 0);
        this.add(g, new BoxGeometry(0.12, 0.12, 0.2), 'dark', 0.06, h / 2 - 0.1, 0);
        break;
      }
      case 'chute': {
        if (d.surface) {
          this.add(g, new BoxGeometry(0.3, h, 0.3), 'orange', 0.15, 0, 0);
        } else {
          this.add(g, new CylinderGeometry(r, r * 1.05, h * 0.7, 24), 'orange', 0, -h * 0.15, 0);
          this.add(g, new SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 'white', 0, h * 0.2, 0);
        }
        break;
      }
      case 'shield': {
        this.add(g, lathe([[0, -h / 2 - h * 0.45], [r * 0.5, -h / 2 - h * 0.35], [r * 0.9, -h / 2 - h * 0.1], [r, -h / 2], [r, h / 2], [0, h / 2]]), 'ablator');
        break;
      }
      case 'panel': {
        this.add(g, new BoxGeometry(r * 2, h, 0.04), 'solar', r, 0, 0);
        this.add(g, new BoxGeometry(0.1, 0.1, 0.1), 'steel', 0.05, 0, 0);
        this.add(g, new BoxGeometry(r * 2, 0.025, 0.045), 'steel', r, 0, 0);
        break;
      }
      case 'battery': {
        if (d.surface) this.add(g, new BoxGeometry(0.3, h, 0.3), 'dark', 0.15, 0, 0);
        else {
          this.add(g, new CylinderGeometry(r, r, h, SEGMENTS), 'dark');
          this.add(g, new CylinderGeometry(r * 1.01, r * 1.01, 0.06, SEGMENTS), 'accent', 0, 0, 0);
        }
        break;
      }
      case 'rcs': {
        this.add(g, new BoxGeometry(0.16, h, 0.16), 'steel', 0.08, 0, 0);
        for (const [x, y, z, rot] of [[0.16, 0, 0, 'x'], [0.08, h / 2, 0, 'y'], [0.08, -h / 2, 0, 'y'], [0.08, 0, 0.1, 'z']] as const) {
          const nozzle = this.add(g, new CylinderGeometry(0.02, 0.045, 0.1, 10), 'dark', x, y, z);
          nozzle.rotation.z = rot === 'x' ? -Math.PI / 2 : 0;
          if (rot === 'z') nozzle.rotation.x = Math.PI / 2;
        }
        break;
      }
      case 'wheel': {
        this.add(g, new CylinderGeometry(r, r, h, SEGMENTS), 'steel');
        this.add(g, new TorusGeometry(r * 0.995, 0.02, 8, SEGMENTS), 'accent', 0, 0, 0).rotation.x = Math.PI / 2;
        break;
      }
    }
    return g;
  }

  private buildEngine(g: Group, d: PartDef): void {
    const h = d.height;
    const r = d.radius;
    if (d.look === 'ion') {
      this.add(g, new CylinderGeometry(r * 0.7, r * 0.7, h * 0.4, SEGMENTS), 'steel', 0, h * 0.3, 0);
      this.add(g, new CylinderGeometry(r * 0.95, r * 0.95, 0.04, SEGMENTS), 'dark', 0, h / 2 - 0.02, 0);
      this.add(g, lathe([[r * 0.55, h * 0.1], [r * 0.9, -h * 0.25], [r * 0.9, -h / 2 + 0.03], [r * 0.82, -h / 2 + 0.03], [r * 0.82, -h * 0.25]]), 'gold');
      this.add(g, new CylinderGeometry(r * 0.8, r * 0.8, 0.03, SEGMENTS), 'accent', 0, -h / 2 + 0.03, 0);
      return;
    }
    // Mount, chamber and a bell that flares from a narrow throat to nearly the full diameter.
    this.add(g, new CylinderGeometry(r, r, h * 0.12, SEGMENTS), 'dark', 0, h / 2 - h * 0.06, 0);
    this.add(g, new CylinderGeometry(r * 0.45, r * 0.5, h * 0.22, 24), 'steel', 0, h / 2 - h * 0.23, 0);
    const bell: Array<[number, number]> = [];
    const top = h / 2 - h * 0.3;
    const length = top + h / 2; // the bell ends exactly at the bottom node
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      bell.push([r * (0.22 + 0.74 * (1 - Math.pow(1 - t, 2.3))), top - t * length]);
    }
    for (let i = bell.length - 1; i >= 0; i--) bell.push([bell[i]![0] - 0.02, bell[i]![1]]);
    this.add(g, lathe(bell), 'copper');
    this.add(g, new TorusGeometry(r * 0.96, 0.03, 8, SEGMENTS), 'steel', 0, bell[18]![1], 0).rotation.x = Math.PI / 2;
  }
}

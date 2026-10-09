/**
 * The launch complex, built from boxes and cylinders with PBR materials: a concrete pad with a scorched flame trench and
 * hold-down posts, a lattice launch tower with swing arms, lightning masts, propellant spheres, a service building and an
 * access road. It stands on the levelled ground of the launch site and rides along with the rotating planet.
 */
import { BoxGeometry, CircleGeometry, Color, CylinderGeometry, Group, Mesh, MeshStandardNodeMaterial, SphereGeometry, Vector3, type BufferGeometry, type Scene } from 'three/webgpu';
import type { LaunchSite } from '../data/sites';
import { lonLatToDirection } from '../terrain/cube-sphere';
import { qfromBasis, qmul, qrot, vcross, vnorm, type Quat, type V3 } from './math3';

const DEG = Math.PI / 180;

export interface PadFrame {
  /** Centre of the pad, east, up and south directions in the planet's body-fixed frame. */
  center: V3;
  east: V3;
  up: V3;
  south: V3;
  /** Rotation of the pad's local frame (X east, Y up, Z south) into the body-fixed frame. */
  q: Quat;
}

export function padFrame(site: LaunchSite, planetRadius: number): PadFrame {
  const d = lonLatToDirection(site.lon * DEG, site.lat * DEG, new Float64Array(3));
  const up = vnorm([d[0]!, d[1]!, d[2]!]);
  const north = vnorm([-up[0] * up[1], 1 - up[1] * up[1], -up[2] * up[1]]);
  const east = vnorm(vcross(north, up));
  const south: V3 = [-north[0], -north[1], -north[2]];
  const r = planetRadius + site.height;
  return { center: [up[0] * r, up[1] * r, up[2] * r], east, up, south, q: qfromBasis(east, up, south) };
}

export class LaunchPad {
  readonly group = new Group();
  readonly frame: PadFrame;
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: MeshStandardNodeMaterial[] = [];
  private readonly tmp = new Vector3();
  private tower: Group | null = null;

  constructor(scene: Scene, site: LaunchSite, planetRadius: number) {
    this.frame = padFrame(site, planetRadius);
    this.build();
    scene.add(this.group);
  }

  private mat(color: number, metalness: number, roughness: number, emissive = 0): MeshStandardNodeMaterial {
    const m = new MeshStandardNodeMaterial({ color: new Color(color), metalness, roughness });
    if (emissive) m.emissive = new Color(emissive);
    this.materials.push(m);
    return m;
  }

  private add(geometry: BufferGeometry, material: MeshStandardNodeMaterial, x: number, y: number, z: number, parent: Group = this.group): Mesh {
    this.geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  private box(w: number, h: number, d: number, m: MeshStandardNodeMaterial, x: number, y: number, z: number): Mesh {
    return this.add(new BoxGeometry(w, h, d), m, x, y, z);
  }

  private build(): void {
    const concrete = this.mat(0x8c9096, 0.05, 0.92);
    const dark = this.mat(0x24262a, 0.1, 0.95);
    const scorch = this.mat(0x151618, 0.2, 0.9);
    const steel = this.mat(0x7f8791, 0.75, 0.5);
    const rust = this.mat(0xb5532c, 0.5, 0.6);
    const white = this.mat(0xe9ebee, 0.1, 0.6);
    const glass = this.mat(0x1b2a38, 0.8, 0.2);
    const redLight = this.mat(0xff2a1a, 0, 0.4, 0xff2a1a);

    // Pad slab, a hair above the (levelled) ground, with the flame trench and its deflector.
    this.add(new CylinderGeometry(70, 70, 0.12, 64), concrete, 0, 0.06, 0);
    this.box(16, 0.04, 64, scorch, 0, 0.14, 34);
    this.add(new CylinderGeometry(9, 9, 0.04, 48), scorch, 0, 0.14, 0);
    const deflector = this.box(10, 0.6, 18, steel, 0, 0.3, 14);
    deflector.rotation.x = 0.35;
    // Launch mount: a ring table and four hold-down posts.
    this.add(new CylinderGeometry(4.2, 4.6, 0.5, 40), steel, 0, 0.25, 0);
    for (const [x, z] of [[3.1, 0], [-3.1, 0], [0, 3.1], [0, -3.1]] as const) this.box(0.6, 1.6, 0.6, rust, x, 0.9, z);

    // Launch tower, west of the rocket: four legs, rings of cross beams, platforms and swing arms.
    const tx = -24;
    const H = 84;
    const tower = new Group();
    tower.position.set(tx, 0, 0);
    this.group.add(tower);
    this.tower = tower;
    for (const [x, z] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]] as const) this.add(new BoxGeometry(0.9, H, 0.9), rust, x, H / 2, z, tower);
    for (let y = 4; y < H; y += 6) {
      this.add(new BoxGeometry(9.9, 0.4, 0.4), rust, 0, y, -4.5, tower);
      this.add(new BoxGeometry(9.9, 0.4, 0.4), rust, 0, y, 4.5, tower);
      this.add(new BoxGeometry(0.4, 0.4, 9.9), rust, -4.5, y, 0, tower);
      this.add(new BoxGeometry(0.4, 0.4, 9.9), rust, 4.5, y, 0, tower);
      const brace = this.add(new BoxGeometry(0.25, 8.2, 0.25), rust, 0, y + 3, -4.5, tower);
      brace.rotation.z = 0.7;
    }
    for (const y of [14, 28, 42, 56, 70]) this.add(new BoxGeometry(10.4, 0.35, 10.4), steel, 0, y, 0, tower);
    for (const y of [16, 32, 48]) {
      this.add(new BoxGeometry(17, 1.3, 1.8), white, 12, y, 0, tower); // swing arm reaching to the rocket
      this.add(new BoxGeometry(1.6, 3, 2.6), steel, 20.2, y, 0, tower);
    }
    this.add(new BoxGeometry(0.35, 16, 0.35), steel, 0, H + 8, 0, tower);
    for (const [x, y, z] of [[0, H + 16.4, 0], [4.5, H, 4.5], [-4.5, H, -4.5], [-4.5, 42, 4.5], [4.5, 42, -4.5]] as const) this.add(new SphereGeometry(0.4, 12, 8), redLight, x, y, z, tower);

    // Lightning masts
    for (const x of [-95, 95]) {
      this.add(new CylinderGeometry(0.35, 0.8, 100, 10), steel, x, 50, -80);
      this.add(new SphereGeometry(0.6, 12, 8), redLight, x, 100.5, -80);
    }

    // Propellant spheres on legs
    for (const x of [-120, -150]) {
      this.add(new SphereGeometry(10, 36, 24), white, x, 17, -95);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        this.add(new CylinderGeometry(0.5, 0.5, 8, 8), steel, x + Math.cos(a) * 7, 4, -95 + Math.sin(a) * 7);
      }
      this.box(30, 0.3, 0.5, steel, x + 20, 1, -95);
    }

    // Service building and access road
    this.box(60, 70, 50, white, 280, 35, -230);
    this.box(0.8, 52, 22, dark, 280, 26, -204.6);
    this.box(60.4, 3, 50.4, rust, 280, 66, -230);
    for (let i = -2; i <= 2; i++) this.box(8, 14, 0.5, glass, 280 + i * 11, 55, -204.7);
    this.box(14, 0.04, 560, dark, 40, 0.1, 340);
    this.box(380, 0.04, 14, dark, 220, 0.1, 150);
    this.add(new CircleGeometry(80, 48).rotateX(-Math.PI / 2), concrete, 0, 0.02, 0); // wide apron
  }

  /** Size the launch tower to the rocket standing on the pad (about a quarter taller than it). */
  fitTower(rocketHeight: number): void {
    this.tower?.scale.set(1, Math.min(1.3, Math.max(0.3, (rocketHeight * 1.25) / 84)), 1);
  }

  /** Place the complex relative to the camera for this frame. */
  update(planetQuat: Quat, planetPos: Vector3, cameraWorld: Vector3): void {
    const c = qrot(planetQuat, this.frame.center);
    this.tmp.set(c[0], c[1], c[2]).add(planetPos).sub(cameraWorld);
    this.group.visible = this.tmp.length() < 300_000;
    if (!this.group.visible) return;
    this.group.position.copy(this.tmp);
    const q = qmul(planetQuat, this.frame.q);
    this.group.quaternion.set(q[0], q[1], q[2], q[3]);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.group.removeFromParent();
  }
}

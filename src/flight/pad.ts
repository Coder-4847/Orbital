/**
 * The launch complex, built from boxes and cylinders with PBR materials: a concrete pad with a scorched flame trench and
 * hold-down posts, a lattice launch tower with swing arms, lightning masts, flood lights, a water tower, propellant tanks, a
 * crawlerway to the assembly building, a service building, roads and scrub. It stands on the levelled ground of the launch
 * site and rides along with the rotating planet. Too small to see from space, it is only drawn within PAD_DRAW_RANGE.
 */
import { BoxGeometry, CircleGeometry, Color, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardNodeMaterial, RingGeometry, SphereGeometry, Vector3, type BufferGeometry, type Scene } from 'three/webgpu';
import type { LaunchSite } from '../data/sites';
import { lonLatToDirection } from '../terrain/cube-sphere';
import { qfromBasis, qmul, qrot, vcross, vnorm, type Quat, type V3 } from './math3';

const DEG = Math.PI / 180;
/** Beyond this distance (m) the whole complex is about a pixel across and is not drawn. */
const PAD_DRAW_RANGE = 60_000;

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
    const gravel = this.mat(0x9a917c, 0, 1);
    const sand = this.mat(0x8f8a6c, 0, 1);
    const redLight = this.mat(0xff2a1a, 0, 0.4, 0xff2a1a);
    const lamp = this.mat(0xfff3d6, 0, 0.4, 0xfff3d6);
    const flat = (g: BufferGeometry): BufferGeometry => g.rotateX(-Math.PI / 2);

    // Ground, widest first and each layer a hair higher: cleared sandy ground, the gravel apron, the concrete hardstand.
    this.add(flat(new CircleGeometry(150, 40)), sand, 0, 0.02, 0);
    this.add(flat(new RingGeometry(141, 150, 64)), dark, 0, 0.05, 0); // perimeter road
    this.add(flat(new CircleGeometry(84, 8)), gravel, 0, 0.04, 0).rotation.y = Math.PI / 8;
    this.add(new CylinderGeometry(52, 52, 0.12, 8), concrete, 0, 0.06, 0).rotation.y = Math.PI / 8;
    // Flame trench to the south, with its deflector.
    this.box(16, 0.04, 64, scorch, 0, 0.14, 34);
    this.add(new CylinderGeometry(9, 9, 0.04, 48), scorch, 0, 0.14, 0);
    const deflector = this.box(10, 0.6, 18, steel, 0, 0.3, 14);
    deflector.rotation.x = 0.35;
    // Launch mount: a ring table and four hold-down posts.
    this.add(new CylinderGeometry(4.2, 4.6, 0.5, 40), steel, 0, 0.25, 0);
    for (const [x, z] of [[3.1, 0], [-3.1, 0], [0, 3.1], [0, -3.1]] as const) this.box(0.6, 1.6, 0.6, rust, x, 0.9, z);

    // Launch tower, west of the rocket: four legs, rings of cross beams, bracing on every face, platforms and swing arms.
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
      for (const [z, lean] of [[-4.5, 0.7], [4.5, -0.7]] as const) this.add(new BoxGeometry(0.25, 8.2, 0.25), rust, 0, y + 3, z, tower).rotation.z = lean;
      for (const [x, lean] of [[-4.5, 0.7], [4.5, -0.7]] as const) this.add(new BoxGeometry(0.25, 8.2, 0.25), rust, x, y + 3, 0, tower).rotation.x = lean;
    }
    for (const y of [14, 28, 42, 56, 70]) this.add(new BoxGeometry(10.4, 0.35, 10.4), steel, 0, y, 0, tower);
    this.add(new BoxGeometry(4, H, 4), steel, -1.8, H / 2, 0, tower); // lift shaft
    for (const y of [16, 32, 48]) {
      this.add(new BoxGeometry(17, 1.3, 1.8), white, 12, y, 0, tower); // swing arm reaching to the rocket
      this.add(new BoxGeometry(1.6, 3, 2.6), steel, 20.2, y, 0, tower);
    }
    this.add(new BoxGeometry(0.35, 16, 0.35), steel, 0, H + 8, 0, tower);
    for (const [x, y, z] of [[0, H + 16.4, 0], [4.5, H, 4.5], [-4.5, H, -4.5], [-4.5, 42, 4.5], [4.5, 42, -4.5]] as const) this.add(new SphereGeometry(0.4, 12, 8), redLight, x, y, z, tower);

    // Lightning masts at the corners, and flood-light towers facing the rocket.
    for (const [x, z] of [[-95, -80], [95, -80], [-95, 80], [95, 80]] as const) {
      this.add(new CylinderGeometry(0.35, 0.8, 100, 10), steel, x, 50, z);
      this.add(new SphereGeometry(0.6, 12, 8), redLight, x, 100.5, z);
    }
    for (const [x, z] of [[62, -62], [-62, 62], [62, 62]] as const) {
      this.add(new CylinderGeometry(0.4, 0.7, 34, 8), steel, x, 17, z);
      this.box(7, 3, 0.5, lamp, x, 35, z).rotation.y = Math.atan2(x, z);
    }

    // Sound-suppression water tower.
    this.add(new CylinderGeometry(1.6, 2.4, 58, 12), steel, 78, 29, -34);
    this.add(new CylinderGeometry(8, 8, 9, 28), white, 78, 62, -34);
    this.add(new SphereGeometry(8, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), white, 78, 66.5, -34).scale.y = 0.45;

    // Propellant spheres on legs, piped to the pad, and a row of horizontal tanks.
    for (const x of [-120, -150]) {
      this.add(new SphereGeometry(10, 36, 24), white, x, 17, -95);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        this.add(new CylinderGeometry(0.5, 0.5, 8, 8), steel, x + Math.cos(a) * 7, 4, -95 + Math.sin(a) * 7);
      }
      this.box(30, 0.3, 0.5, steel, x + 20, 1, -95);
    }
    for (let i = 0; i < 4; i++) {
      this.add(new CylinderGeometry(3.2, 3.2, 22, 20), white, -128, 4.4, 70 + i * 10).rotation.z = Math.PI / 2;
      for (const x of [-136, -120]) this.box(1.2, 2.4, 7.5, concrete, x, 1.2, 70 + i * 10);
    }

    // Crawlerway: two gravel tracks running north to the assembly building.
    for (const x of [-10.5, 10.5]) this.box(12, 0.06, 560, gravel, x, 0.08, -330);
    this.box(9, 0.05, 560, sand, 0, 0.06, -330);

    // Vehicle assembly building: a tall block with door slots, and a low launch-control wing beside it.
    const vz = -690;
    this.box(150, 164, 130, white, 0, 79, vz);
    this.box(150.6, 6, 130.6, steel, 0, 158, vz);
    for (const x of [-38, 38]) {
      this.box(44, 132, 0.8, dark, x, 66, vz + 65.2);
      for (let y = 20; y < 132; y += 22) this.box(44.4, 0.9, 1, steel, x, y, vz + 65.4);
    }
    this.box(18, 26, 0.8, rust, 0, 136, vz + 65.2);
    this.box(90, 22, 44, concrete, 128, 10, vz + 30);
    for (let i = -3; i <= 3; i++) this.box(9, 6, 0.5, glass, 128 + i * 12, 14, vz + 52.2);
    this.box(70, 0.1, 110, dark, 128, 0.08, vz + 110); // car park

    // Service building and access roads.
    this.box(60, 70, 50, white, 280, 34, -230);
    this.box(0.8, 52, 22, dark, 280, 26, -204.6);
    this.box(60.4, 3, 50.4, rust, 280, 66, -230);
    for (let i = -2; i <= 2; i++) this.box(8, 14, 0.5, glass, 280 + i * 11, 55, -204.7);
    this.box(14, 0.04, 470, dark, 40, 0.1, 384);
    this.box(380, 0.04, 14, dark, 220, 0.1, 150);
    this.box(14, 0.04, 400, dark, 280, 0.1, -43);

    this.scrub();
  }

  /** Low scrub scattered over the ground around the complex, so the eye has something to judge height and speed against. */
  private scrub(): void {
    const geometry = new SphereGeometry(1, 7, 5);
    const material = this.mat(0xffffff, 0, 1);
    this.geometries.push(geometry);
    const count = 1500;
    const bushes = new InstancedMesh(geometry, material, count);
    const m = new Matrix4();
    const colour = new Color();
    let seed = 20261009;
    const rnd = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < count; i++) {
      // Nothing on the cleared ground, the crawlerway, the roads or the buildings.
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 20; tries++) {
        const r = 160 + 760 * Math.sqrt(rnd());
        const a = rnd() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        const onCrawlerway = Math.abs(x) < 24 && z < 0;
        const onRoad = Math.abs(x - 40) < 14 || Math.abs(x - 280) < 14 || (Math.abs(z - 150) < 14 && x > 0);
        const onBuilding = (Math.abs(x) < 200 && z < -590) || (Math.abs(x - 280) < 50 && Math.abs(z + 230) < 45);
        if (!onCrawlerway && !onRoad && !onBuilding) break;
      }
      const w = 1.6 + rnd() * 4.5;
      m.makeScale(w, w * (0.35 + rnd() * 0.35), w * (0.8 + rnd() * 0.4));
      m.setPosition(x, 0.2, z);
      bushes.setMatrixAt(i, m);
      bushes.setColorAt(i, colour.setRGB(0.012 + rnd() * 0.012, 0.03 + rnd() * 0.025, 0.008 + rnd() * 0.006));
    }
    bushes.frustumCulled = false; // the instances spread far beyond the base sphere's bounds
    this.group.add(bushes);
  }

  /** Size the launch tower to the rocket standing on the pad (about a quarter taller than it). */
  fitTower(rocketHeight: number): void {
    this.tower?.scale.set(1, Math.min(1.3, Math.max(0.3, (rocketHeight * 1.25) / 84)), 1);
  }

  /** Place the complex relative to the camera for this frame. */
  update(planetQuat: Quat, planetPos: Vector3, cameraWorld: Vector3): void {
    const c = qrot(planetQuat, this.frame.center);
    this.tmp.set(c[0], c[1], c[2]).add(planetPos).sub(cameraWorld);
    this.group.visible = this.tmp.length() < PAD_DRAW_RANGE;
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

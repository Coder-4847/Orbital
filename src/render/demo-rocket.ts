import {
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardNodeMaterial,
  Shape,
  Vector2,
  type BufferGeometry,
} from 'three/webgpu';

/**
 * A two-stage rocket built from lathe/extrude primitives, used as the menu hero and hangar placeholder.
 * Origin is at the base of the engines; +Y is up. Total height ≈ 14.5 units. Replaced by the real
 * procedural part library in Phase 4.
 */
export function createDemoRocket(): Group {
  const rocket = new Group();

  const paint = new MeshStandardNodeMaterial({ color: 0xe9edf2, roughness: 0.42, metalness: 0.05 });
  const dark = new MeshStandardNodeMaterial({ color: 0x15181d, roughness: 0.38, metalness: 0.7 });
  const metal = new MeshStandardNodeMaterial({ color: 0x7c8590, roughness: 0.3, metalness: 0.9 });

  const lathe = (points: [number, number][], material: MeshStandardNodeMaterial, segments = 48): Mesh =>
    new Mesh(new LatheGeometry(points.map(([r, y]) => new Vector2(r, y)), segments), material);

  const R = 0.55;

  // Engine bell and skirt.
  rocket.add(lathe([[0.2, 1.05], [0.22, 0.85], [0.3, 0.5], [0.39, 0.15], [0.43, 0], [0.4, 0], [0.33, 0.14], [0.26, 0.45], [0.18, 0.8], [0.16, 1.05]], metal));
  rocket.add(lathe([[0.46, 1.0], [0.5, 1.15], [R, 1.5]], dark));

  // First stage, interstage, second stage.
  rocket.add(lathe([[R, 1.5], [R, 8.6]], paint));
  rocket.add(lathe([[R + 0.005, 8.6], [R + 0.005, 9.2]], dark));
  rocket.add(lathe([[R, 9.2], [R, 12.1]], paint));
  for (const y of [3.4, 6.2, 10.6]) rocket.add(lathe([[R + 0.004, y], [R + 0.004, y + 0.07]], dark));

  // Ogive nose fairing.
  const nose: [number, number][] = [];
  const noseLength = 2.5;
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    nose.push([R * Math.sqrt(1 - Math.pow(t, 1.9)), 12.1 + noseLength * t]);
  }
  rocket.add(lathe(nose, paint, 48));

  // Four swept fins at the base.
  const fin = new Shape();
  fin.moveTo(0, 0);
  fin.lineTo(0.95, -0.55);
  fin.lineTo(0.95, 0.35);
  fin.lineTo(0, 2.3);
  fin.closePath();
  const finGeometry: BufferGeometry = new ExtrudeGeometry(fin, { depth: 0.05, bevelEnabled: false });
  for (let i = 0; i < 4; i++) {
    const mesh = new Mesh(finGeometry, dark);
    const holder = new Group();
    mesh.position.set(R - 0.02, 1.7, -0.025);
    holder.add(mesh);
    holder.rotation.y = (i * Math.PI) / 2 + Math.PI / 4;
    rocket.add(holder);
  }

  return rocket;
}

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import { attribute, color, dot, exp, float, mix, mx_fractal_noise_float, normalize, positionLocal, smoothstep, uniform, vec3 } from 'three/tsl';

/** Multiplies the stars and the Milky Way. Dropped when the exposure is set for a sunlit world, so the sky does not wash out. */
export const skyGain = uniform(1);

/** Deterministic PRNG so the sky is identical on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Orientation of the galactic plane in our inertial frame (arbitrary but fixed). */
export const GALACTIC_NORTH = new Vector3(0.18, 0.86, 0.47).normalize();

export interface StarfieldOptions {
  count: number;
  seed?: number;
  /** Sky-dome radius; keep below the camera far plane. */
  radius: number;
}

/**
 * A sky dome: individually placed stars (camera-facing quads, HDR brightness so bright ones bloom)
 * plus a faint procedural Milky Way band. Re-centre it on the camera every frame (see `follow`).
 * Stars are thicker along the galactic plane, which is what makes the band read as a band.
 */
export class Starfield extends Group {
  constructor({ count, seed = 7, radius }: StarfieldOptions) {
    super();
    this.add(createMilkyWay(radius * 1.02), createStars(count, seed, radius));
    this.frustumCulled = false;
    this.children.forEach((c) => {
      c.frustumCulled = false;
      c.renderOrder = -10;
    });
  }

  follow(position: Vector3): void {
    this.position.copy(position);
  }
}

function createStars(count: number, seed: number, radius: number): Mesh {
  const rand = mulberry32(seed);
  const positions = new Float32Array(count * 4 * 3);
  const corners = new Float32Array(count * 4 * 2);
  const colors = new Float32Array(count * 4 * 3);
  const index = new Uint32Array(count * 6);
  const d = new Vector3();
  const t = new Vector3();
  const b = new Vector3();
  const up = new Vector3();
  const cornerXY = [-1, -1, 1, -1, 1, 1, -1, 1];

  for (let i = 0; i < count; i++) {
    // Rejection-sample a direction, favouring the galactic plane.
    for (;;) {
      const z = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      d.set(r * Math.cos(phi), z, r * Math.sin(phi));
      const lat = d.dot(GALACTIC_NORTH) / 0.22;
      if (rand() < 0.16 + 0.84 * Math.exp(-lat * lat)) break;
    }

    // Heavy-tailed brightness: most stars are faint, a few are very bright.
    const u = rand();
    const brightness = 0.12 + 1.9 * Math.pow(u, 11);
    const angular = 0.00042 + 0.00048 * Math.sqrt(brightness / 2.0); // radians
    const half = radius * angular * 3.4;

    const temp = rand();
    const [cr, cg, cb] = temp < 0.12 ? [0.7, 0.82, 1] : temp < 0.55 ? [1, 0.97, 0.94] : temp < 0.82 ? [1, 0.88, 0.72] : [1, 0.74, 0.54];

    up.set(0, Math.abs(d.y) < 0.9 ? 1 : 0, Math.abs(d.y) < 0.9 ? 0 : 1);
    t.crossVectors(up, d).normalize();
    b.crossVectors(d, t);

    for (let c = 0; c < 4; c++) {
      const cx = cornerXY[c * 2]!;
      const cy = cornerXY[c * 2 + 1]!;
      const o = (i * 4 + c) * 3;
      positions[o] = d.x * radius + (t.x * cx + b.x * cy) * half;
      positions[o + 1] = d.y * radius + (t.y * cx + b.y * cy) * half;
      positions[o + 2] = d.z * radius + (t.z * cx + b.z * cy) * half;
      corners[(i * 4 + c) * 2] = cx;
      corners[(i * 4 + c) * 2 + 1] = cy;
      colors[o] = cr * brightness;
      colors[o + 1] = cg * brightness;
      colors[o + 2] = cb * brightness;
    }
    const v = i * 4;
    index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aCorner', new Float32BufferAttribute(corners, 2));
  geometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(index, 1));

  const corner = attribute('aCorner', 'vec2');
  const r2 = dot(corner, corner);
  const falloff = exp(r2.mul(-6)).mul(float(1).sub(smoothstep(0.6, 1, r2)));

  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
  material.colorNode = attribute('aColor', 'vec3').mul(falloff).mul(skyGain);
  return new Mesh(geometry, material);
}

function createMilkyWay(radius: number): Mesh {
  const dir = normalize(positionLocal);
  const n = vec3(GALACTIC_NORTH.x, GALACTIC_NORTH.y, GALACTIC_NORTH.z);
  const lat = dot(dir, n);
  const band = exp(lat.div(0.2).pow(2).negate());
  const wide = exp(lat.div(0.55).pow(2).negate());

  const clouds = mx_fractal_noise_float(dir.mul(2.6), 5, 2.1, 0.55).mul(0.5).add(0.5);
  const dust = smoothstep(0.35, 0.65, mx_fractal_noise_float(dir.mul(vec3(5.5, 9, 5.5)).add(vec3(3.1, 0.7, 1.9)), 4, 2.2, 0.5).mul(0.5).add(0.5));
  // Brighter toward a "galactic centre" direction in the plane.
  const centre = normalize(vec3(0.84, -0.15, -0.52));
  const core = smoothstep(-0.2, 1, dot(dir, centre));

  const glow = band.mul(clouds.mul(0.9).add(0.25)).add(wide.mul(0.06)).mul(float(1).sub(dust.mul(band).mul(0.75)));
  const tint = mix(color(0x7f9fd8), color(0xf2dcc0), core.mul(0.6));

  const material = new MeshBasicNodeMaterial({ side: BackSide, transparent: true, depthWrite: false, blending: AdditiveBlending });
  material.colorNode = tint.mul(glow.mul(core.mul(0.7).add(0.3))).mul(0.11).mul(skyGain);
  return new Mesh(new SphereGeometry(radius, 48, 24), material);
}

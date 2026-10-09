import { DoubleSide, Mesh, MeshBasicNodeMaterial, RingGeometry, type Node } from 'three/webgpu';
import { abs, dot, exp, float, fwidth, length, max, mix, normalize, normalWorld, positionLocal, positionWorld, saturate, select, sign, sin, smoothstep, vec3, vec4 } from 'three/tsl';
import type { RingDef } from '../data/solar-system';
import type { PlanetUniforms } from './planet-uniforms';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const STEP = (a: number, b: number, x: F): F => smoothstep(a, b, x) as F;

/**
 * Optical depth of Saturn's rings at distance `rMm` (in Mm, i.e. thousands of km) from the planet's centre: D, C and B rings, the Cassini division,
 * the A ring with the Encke gap, plus fine ringlet structure. Shared by the ring mesh and by the ring shadow cast on
 * the planet, so the two always agree.
 */
export function ringOpticalDepth(rMm: F): F {
  const C = float(0.12).mul(STEP(74, 75.5, rMm)).mul(float(1).sub(STEP(91.5, 92.5, rMm)));
  const B = float(1.0)
    .add(STEP(95, 105, rMm).mul(1.2))
    .sub(STEP(110, 117, rMm).mul(0.45))
    .mul(STEP(91.8, 92.6, rMm))
    .mul(float(1).sub(STEP(117.2, 117.7, rMm)));
  const cassini = float(0.07).mul(STEP(117.2, 117.8, rMm)).mul(float(1).sub(STEP(121.8, 122.4, rMm)));
  const encke = float(1).sub(float(0.92).mul(float(1).sub(STEP(0, 0.22, abs(rMm.sub(133.45))))));
  const A = float(0.55).mul(STEP(122, 122.7, rMm)).mul(float(1).sub(STEP(136.4, 136.9, rMm))).mul(encke);
  const D = float(0.02).mul(STEP(66, 72, rMm)).mul(float(1).sub(STEP(74, 75, rMm)));
  // Fine ringlets: a product of incommensurate sines reads as irregular radial banding. Faded out where the bands are
  // finer than a pixel, which would otherwise alias into moire.
  const px = fwidth(rMm);
  const resolved = float(1).sub(STEP(0.25, 0.7, px.mul(61))) as F;
  const ringlets = float(0.78).add(float(0.22).mul(sin(rMm.mul(61))).mul(sin(rMm.mul(17.3).add(1.7))).mul(resolved)) as F;
  return D.add(C).add(B).add(cassini).add(A).mul(ringlets) as F;
}

/** Ring colour: dark brownish C ring, bright tan B ring, greyer A ring. */
function ringColour(rMm: F): V3 {
  const c = vec3(0.34, 0.3, 0.26);
  const b = vec3(0.86, 0.76, 0.6);
  const a = vec3(0.74, 0.69, 0.62);
  return mix(mix(c, b, STEP(88, 98, rMm)), a, STEP(117, 124, rMm)) as V3;
}

/**
 * Saturn's ring system as one flat annulus in the planet's equatorial plane (body-fixed XZ). Everything about the rings
 * is analytic in the fragment shader (radius -> optical depth), so there is no texture and no resolution limit. Lit on the
 * sunward side, translucent when the Sun is behind them, and shadowed by the planet.
 */
export function createRings(def: RingDef, uniforms: PlanetUniforms, planetRadius: number): Mesh {
  const geometry = new RingGeometry(def.inner, def.outer, 256, 4);
  geometry.rotateX(-Math.PI / 2); // into the equatorial plane, normal +Y (the planet's north)

  const rMm = length(positionLocal.xz).div(1e6) as F; // Mm, as in ringOpticalDepth
  const tau = ringOpticalDepth(rMm);
  const nW = normalize(normalWorld) as V3;
  const V = normalize(positionWorld.negate()) as V3;
  const L = uniforms.sunDir as V3;
  const sunSide = sign(dot(nW, L));
  const viewSide = sign(dot(nW, V));
  const muSun = max(abs(dot(nW, L)), 0.04) as F;
  const muView = max(abs(dot(nW, V)), 0.04) as F;

  // Planet's shadow on the rings: does the ray towards the Sun pass through the planet sphere?
  const P = positionWorld.sub(uniforms.center) as V3;
  const along = dot(P, L);
  const miss = length(P.sub(L.mul(along)));
  const shadow = select(along.lessThan(0), smoothstep(planetRadius * 0.995, planetRadius * 1.005, miss), float(1)) as F;

  const albedo = ringColour(rMm);
  const sameSide = sunSide.mul(viewSide).greaterThan(0);
  const reflect = float(1).sub(exp(tau.mul(-2.2)));
  const lit = albedo.mul(uniforms.sunE).mul(reflect).mul(muSun).mul(0.65).div(Math.PI) as V3;
  const thin = exp(tau.negate().div(muSun));
  const transmitted = albedo.mul(uniforms.sunE).mul(reflect.mul(0.12).mul(muSun).add(tau.mul(thin).div(tau.add(1)).mul(0.55))).div(Math.PI) as V3;
  const radiance = select(sameSide, lit, transmitted).mul(shadow).add(albedo.mul(uniforms.sunE).mul(0.0004).mul(reflect)) as V3;

  const opacity = saturate(float(1).sub(exp(tau.negate().div(muView)))) as F;
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  material.fragmentNode = vec4(radiance, opacity);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'rings';
  mesh.frustumCulled = false; // the annulus is huge and its bounding sphere is fine, but culling by it is never worth a pop
  mesh.renderOrder = 4;
  return mesh;
}

import { acos, atan, clamp, cross, dot, float, length, max, min, select, sqrt } from 'three/tsl';
import type { Node } from 'three/webgpu';

type F = Node<'float'>;
type V3 = Node<'vec3'>;
type V4 = Node<'vec4'>;

const SUN_RADIUS = 6.957e8;

/**
 * Fraction (0..1) of the Sun's disc still visible from `fragment` when `occluder` (xyz = centre, w = radius, all relative
 * to the same origin as `fragment` and `sun`) may pass in front of it. Exact disc-overlap geometry, so umbra, penumbra and
 * annular eclipses all come out of the same formula. Angles are small, so discs are treated as flat on the sky.
 */
export function sunVisibility(fragment: V3, sun: V3, occluder: V4): F {
  const toSun = sun.sub(fragment);
  const dSun = length(toSun);
  const sunDir = toSun.div(dSun);
  const toOcc = occluder.xyz.sub(fragment);
  const dOcc = max(length(toOcc), 1);
  const occDir = toOcc.div(dOcc);

  const aS = float(SUN_RADIUS).div(dSun) as F; // angular radius of the Sun
  const aO = min(occluder.w.div(dOcc), 1.5) as F; // angular radius of the occluder
  // Separation via atan2(|cross|, dot): accurate for the tiny angles involved (acos is not, in float32).
  const theta = atan(length(cross(sunDir, occDir)), dot(sunDir, occDir)) as F;

  const sunArea = aS.mul(aS) as F;
  const small = min(aS, aO);
  const t = max(theta, 1e-9) as F;
  const cos1 = clamp(t.mul(t).add(aS.mul(aS)).sub(aO.mul(aO)).div(t.mul(aS).mul(2)), -1, 1);
  const cos2 = clamp(t.mul(t).add(aO.mul(aO)).sub(aS.mul(aS)).div(t.mul(aO).mul(2)), -1, 1);
  const k = max(t.negate().add(aS).add(aO).mul(t.add(aS).sub(aO)).mul(t.sub(aS).add(aO)).mul(t.add(aS).add(aO)), 0);
  const lens = aS.mul(aS).mul(acos(cos1)).add(aO.mul(aO).mul(acos(cos2))).sub(sqrt(k).mul(0.5));
  const full = small.mul(small).mul(Math.PI);

  const overlap = select(theta.greaterThanEqual(aS.add(aO)), float(0), select(theta.lessThanEqual(aO.sub(aS).abs()), full, lens)) as F;
  const inFront = dOcc.lessThan(dSun);
  const hidden = select(inFront.and(occluder.w.greaterThan(0)), overlap.div(sunArea.mul(Math.PI)), float(0));
  return float(1).sub(clamp(hidden, 0, 1)) as F;
}

/** Combined visibility from two possible occluders. */
export const sunVisibility2 = (fragment: V3, sun: V3, a: V4, b: V4): F => sunVisibility(fragment, sun, a).mul(sunVisibility(fragment, sun, b)) as F;


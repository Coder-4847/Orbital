import { float, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/**
 * Sun colour and sky ambient at a point inside an atmosphere (or above it: both fade to the bare sun and zero ambient).
 * `lookup` is the transmittance LUT lookup of the atmosphere in question; `planetRadius` its surface radius (m).
 * Ambient uses the sun's transmittance at 10 km altitude, where the horizon has dipped below the ground one, so twilight
 * skylight fades smoothly instead of switching off at sunset.
 */
export function atmosphereLighting(sunE: V3, lookup: (r: F, mu: F) => V3, planetRadius: number | F, r: F, mu: F): { sunColour: V3; ambient: V3 } {
  const sunT = lookup(r, mu);
  const vertical = lookup(r, float(1));
  const surface: F = typeof planetRadius === 'number' ? (float(planetRadius) as F) : planetRadius;
  const twilight = lookup(surface.add(10_000) as F, mu);
  const skyAmount = vec3(1, 1, 1).sub(vertical).mul(0.55);
  const ambient = sunE.mul(skyAmount).mul(twilight).add(sunE.mul(0.00018)) as V3;
  return { sunColour: sunE.mul(sunT) as V3, ambient };
}

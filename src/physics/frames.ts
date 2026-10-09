/**
 * Coordinate frames. Pure maths, no rendering imports.
 *
 * World/inertial frame (also three.js axes): +Y = ecliptic north, +X = vernal equinox (J2000), ecliptic longitude
 * increases towards -Z. Body-fixed frame: +Y = north pole, +X = prime meridian, east towards -Z.
 * Source data (IAU WGCCRE pole/rotation) is given in the ICRF equatorial frame, so we convert through the ecliptic.
 */
import type { Vec3 } from './kepler';
import { cross, scale, add, length } from './kepler';

const DEG = Math.PI / 180;
export const OBLIQUITY_J2000 = 23.4392911 * DEG;
const cosE = Math.cos(OBLIQUITY_J2000);
const sinE = Math.sin(OBLIQUITY_J2000);

/** Standard ecliptic coordinates (x east-of-equinox, y longitude 90, z north) -> world axes. */
export const eclipticToWorld = (v: Vec3): Vec3 => [v[0], v[2], -v[1]];

/** ICRF equatorial (x equinox, z celestial north) -> world axes. */
export function icrfToWorld(v: Vec3): Vec3 {
  const y = v[1] * cosE + v[2] * sinE;
  const z = -v[1] * sinE + v[2] * cosE;
  return [v[0], z, -y];
}

/** Unit vector of a body's north pole in world axes from IAU right ascension / declination (degrees). */
export function poleWorld(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  return icrfToWorld([Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]);
}

export interface BodyAxes {
  /** Prime meridian direction (body-fixed +X), north pole (+Y) and +Z, all in world axes. */
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

/**
 * Body-fixed axes in world coordinates for IAU pole (ra, dec) and prime-meridian angle W (all degrees).
 * IAU: the prime meridian lies at angle W east of the node of the body's equator on the ICRF equator.
 */
export function bodyAxes(raDeg: number, decDeg: number, wDeg: number): BodyAxes {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const w = wDeg * DEG;
  const poleIcrf: Vec3 = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const node: Vec3 = [Math.cos(ra + Math.PI / 2), Math.sin(ra + Math.PI / 2), 0];
  const iauX = add(scale(node, Math.cos(w)), scale(cross(poleIcrf, node), Math.sin(w)));
  const iauY = cross(poleIcrf, iauX);
  // IAU (X meridian, Y east, Z north) -> ours (X meridian, Y north, Z = -east).
  return { x: icrfToWorld(iauX), y: icrfToWorld(poleIcrf), z: icrfToWorld(scale(iauY, -1)) };
}

/** Quaternion [x, y, z, w] of the rotation matrix whose columns are the given orthonormal basis (maps body-fixed -> world). */
export function quaternionFromBasis(bx: Vec3, by: Vec3, bz: Vec3): [number, number, number, number] {
  const m00 = bx[0], m01 = by[0], m02 = bz[0];
  const m10 = bx[1], m11 = by[1], m12 = bz[1];
  const m20 = bx[2], m21 = by[2], m22 = bz[2];
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}

/** Orbit reference frame (a right-handed basis in world axes) whose +Z is the orbit normal. */
export interface OrbitFrame {
  ex: Vec3;
  ey: Vec3;
  ez: Vec3;
}

/** The ecliptic plane: x = equinox, y = longitude 90 (world -Z), normal = ecliptic north (world +Y). */
export const ECLIPTIC_FRAME: OrbitFrame = { ex: [1, 0, 0], ey: [0, 0, -1], ez: [0, 1, 0] };

/** A body's equatorial plane, with +X along the equinox projected into the plane. Used for moon orbits near the parent equator. */
export function equatorFrame(raDeg: number, decDeg: number): OrbitFrame {
  const ez = poleWorld(raDeg, decDeg);
  let ex: Vec3 = [1 - ez[0] * ez[0], -ez[0] * ez[1], -ez[0] * ez[2]];
  const n = length(ex);
  ex = n > 1e-9 ? scale(ex, 1 / n) : [0, 0, 1];
  return { ex, ey: cross(ez, ex), ez };
}

/** Convert a vector from an orbit frame's coordinates to world axes. */
export const frameToWorld = (f: OrbitFrame, v: Vec3): Vec3 => [
  f.ex[0] * v[0] + f.ey[0] * v[1] + f.ez[0] * v[2],
  f.ex[1] * v[0] + f.ey[1] * v[1] + f.ez[1] * v[2],
  f.ex[2] * v[0] + f.ey[2] * v[1] + f.ez[2] * v[2],
];

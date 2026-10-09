/**
 * Small 3D maths for the flight physics: vectors as [x, y, z], quaternions as [x, y, z, w], 3x3 matrices as 9 numbers in row-major
 * order. Plain arrays of doubles; no rendering imports.
 */
export type V3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const vadd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vscale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const vdot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vlen = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export function vnorm(a: V3): V3 {
  const l = vlen(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}
/** a + b * k without allocating an intermediate. */
export const vmad = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

export const QIDENTITY: Quat = [0, 0, 0, 1];

export function qmul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

export function qnorm(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Rotate a vector by a unit quaternion. */
export function qrot(q: Quat, v: V3): V3 {
  // v' = v + 2w (u x v) + 2 u x (u x v), with u the vector part
  const ux = q[0];
  const uy = q[1];
  const uz = q[2];
  const w = q[3];
  const cx = uy * v[2] - uz * v[1];
  const cy = uz * v[0] - ux * v[2];
  const cz = ux * v[1] - uy * v[0];
  return [v[0] + 2 * (w * cx + uy * cz - uz * cy), v[1] + 2 * (w * cy + uz * cx - ux * cz), v[2] + 2 * (w * cz + ux * cy - uy * cx)];
}

/** Inverse rotation: from the rotated frame back into the original one. */
export const qrotInv = (q: Quat, v: V3): V3 => qrot(qconj(q), v);

export function qfromAxisAngle(axis: V3, angle: number): Quat {
  const n = vnorm(axis);
  const s = Math.sin(angle / 2);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)];
}

/** Shortest rotation taking unit vector `a` onto unit vector `b`. */
export function qfromTo(a: V3, b: V3): Quat {
  const d = vdot(a, b);
  if (d > 0.999999) return QIDENTITY;
  if (d < -0.999999) {
    const axis = Math.abs(a[0]) < 0.9 ? vcross(a, [1, 0, 0]) : vcross(a, [0, 1, 0]);
    return qfromAxisAngle(axis, Math.PI);
  }
  const c = vcross(a, b);
  return qnorm([c[0], c[1], c[2], 1 + d]);
}

/** Advance an orientation by body-frame angular velocity `w` (rad/s) over `dt`. */
export function qintegrate(q: Quat, w: V3, dt: number): Quat {
  const angle = vlen(w) * dt;
  if (angle < 1e-12) return q;
  return qnorm(qmul(q, qfromAxisAngle(w, angle)));
}

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
  return out;
}

export const mat3Vec = (m: Mat3, v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

export function mat3Inverse(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-30) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

/** Angle (radians) of a rotation, from its quaternion. */
export const qangle = (q: Quat): number => 2 * Math.acos(Math.min(1, Math.abs(q[3])));

export const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);

/** Unit quaternion of the rotation whose columns (the images of X, Y, Z) are the given orthonormal vectors. */
export function qfromBasis(x: V3, y: V3, z: V3): Quat {
  const m00 = x[0], m10 = x[1], m20 = x[2];
  const m01 = y[0], m11 = y[1], m21 = y[2];
  const m02 = z[0], m12 = z[1], m22 = z[2];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return qnorm([(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]);
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return qnorm([0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]);
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return qnorm([(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]);
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return qnorm([(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]);
}

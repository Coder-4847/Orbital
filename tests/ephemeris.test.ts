import { describe, expect, it } from 'vitest';
import { AU, BODIES } from '../src/data/solar-system';
import { Ephemeris } from '../src/physics/ephemeris';
import { bodyAxes, equatorFrame, icrfToWorld, OBLIQUITY_J2000, poleWorld, quaternionFromBasis } from '../src/physics/frames';
import { cross, dot, length, sub, type Vec3 } from '../src/physics/kepler';

const DAY = 86400;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const ut = (iso: string) => (Date.parse(iso) - J2000_MS) / 1000;
const eph = new Ephemeris();
const at = (id: string, t: number): Vec3 => {
  eph.update(t);
  return [...eph.get(id).pos] as Vec3;
};
const angleDeg = (a: Vec3, b: Vec3) => (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (length(a) * length(b))))) * 180) / Math.PI;
const rotate = (q: [number, number, number, number], v: Vec3): Vec3 => {
  const [x, y, z, w] = q;
  const t: Vec3 = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
};

describe('planet positions against known events', () => {
  it('Earth is at perihelion (0.9833 AU) in early January 2000 and aphelion (1.0167 AU) in early July', () => {
    expect(length(at('earth', ut('2000-01-03T05:00:00Z'))) / AU).toBeCloseTo(0.98327, 3);
    expect(length(at('earth', ut('2000-07-03T23:00:00Z'))) / AU).toBeCloseTo(1.01667, 3);
  });

  it('the March 2000 equinox puts Earth at heliocentric ecliptic longitude 180 degrees', () => {
    const p = at('earth', ut('2000-03-20T07:35:00Z'));
    const lon = (Math.atan2(-p[2], p[0]) * 180) / Math.PI; // ecliptic longitude increases towards world -Z
    expect(Math.abs(((lon + 360) % 360) - 180)).toBeLessThan(0.15);
  });

  it('Mars is closest to Earth (~0.414 AU) around 6 October 2020', () => {
    const t = ut('2020-10-06T00:00:00Z');
    const d = length(sub(at('mars', t), at('earth', t))) / AU;
    expect(d).toBeGreaterThan(0.405);
    expect(d).toBeLessThan(0.425);
  });

  it('Jupiter and Saturn are in great conjunction on 21 December 2020 (within ~0.5 degrees seen from Earth)', () => {
    const t = ut('2020-12-21T18:00:00Z');
    const earth = at('earth', t);
    const sep = angleDeg(sub(at('jupiter', t), earth), sub(at('saturn', t), earth));
    expect(sep).toBeLessThan(0.5);
  });

  it('Venus returns to the same heliocentric longitude after its 224.70 day sidereal period', () => {
    const a = at('venus', ut('2010-01-01T00:00:00Z'));
    const b = at('venus', ut('2010-01-01T00:00:00Z') + 224.701 * DAY);
    expect(angleDeg(a, b)).toBeLessThan(0.2);
  });

  it('planets stay at plausible distances for dates far from J2000 (1850, 2150)', () => {
    for (const year of [1850, 2150]) {
      const t = ut(`${year}-06-01T00:00:00Z`);
      expect(length(at('earth', t)) / AU).toBeGreaterThan(0.98);
      expect(length(at('earth', t)) / AU).toBeLessThan(1.02);
      expect(length(at('jupiter', t)) / AU).toBeGreaterThan(4.9);
      expect(length(at('jupiter', t)) / AU).toBeLessThan(5.5);
    }
  });
});

describe('Moon', () => {
  const elongation = (t: number) => {
    const earth = at('earth', t);
    const moon = at('moon', t);
    return angleDeg(sub(moon, earth), [-earth[0], -earth[1], -earth[2]]); // angle Moon-Earth-Sun
  };

  it('is new at the January 2000 and April 2024 new moons and full at the January 2000 full moon', () => {
    expect(elongation(ut('2000-01-06T18:14:00Z'))).toBeLessThan(2.5);
    expect(elongation(ut('2024-04-08T18:21:00Z'))).toBeLessThan(1);
    expect(elongation(ut('2000-01-21T04:40:00Z'))).toBeGreaterThan(178.5);
  });

  it('puts the lunar shadow axis on the Earth during the 8 April 2024 total solar eclipse', () => {
    const t = ut('2024-04-08T18:17:00Z');
    const earth = at('earth', t);
    const moon = at('moon', t);
    const dir = [moon[0] / length(moon), moon[1] / length(moon), moon[2] / length(moon)] as Vec3; // Sun -> Moon
    const o = sub(earth, moon);
    const along = o[0] * dir[0] + o[1] * dir[1] + o[2] * dir[2];
    const miss = Math.sqrt(Math.max(length(o) ** 2 - along * along, 0));
    expect(along).toBeGreaterThan(0); // Earth is beyond the Moon, in its shadow
    expect(miss).toBeLessThan(0.9 * 6.371e6); // the axis passes through the disc, not past its edge
  });

  it('orbits at 357-407 thousand km with the sidereal month of 27.32 days', () => {
    for (let k = 0; k < 30; k++) {
      const t = k * 1.1 * DAY;
      const d = length(sub(at('moon', t), at('earth', t)));
      expect(d).toBeGreaterThan(3.55e8);
      expect(d).toBeLessThan(4.1e8);
    }
    const t0 = ut('2010-05-05T00:00:00Z');
    const a = sub(at('moon', t0), at('earth', t0));
    const t1 = t0 + 27.3217 * DAY;
    const b = sub(at('moon', t1), at('earth', t1));
    expect(angleDeg(a, b)).toBeLessThan(6);
  });

  it('keeps its near side towards Earth within libration (about 10 degrees)', () => {
    for (const t of [0, 5 * DAY, 11 * DAY, 18 * DAY, 25 * DAY]) {
      eph.update(t);
      const lon0 = rotate(eph.get('moon').q, [1, 0, 0]);
      const toEarth = sub(eph.get('earth').pos, eph.get('moon').pos);
      expect(angleDeg(lon0, toEarth)).toBeLessThan(12);
    }
  });
});

describe('velocities are consistent with positions', () => {
  it('central differences of position match the reported velocity for every body', () => {
    const t = ut('2026-10-08T00:00:00Z');
    const h = 30;
    for (const b of BODIES) {
      if (b.id === 'sun') continue;
      const p0 = at(b.id, t - h);
      const p1 = at(b.id, t + h);
      eph.update(t);
      const v = eph.get(b.id).vel;
      const fd: Vec3 = [(p1[0] - p0[0]) / (2 * h), (p1[1] - p0[1]) / (2 * h), (p1[2] - p0[2]) / (2 * h)];
      expect(length(sub(fd, v)) / length(v)).toBeLessThan(0.02);
    }
  });

  it('Earth moves at about 29.8 km/s', () => {
    eph.update(ut('2026-01-01T00:00:00Z'));
    expect(length(eph.get('earth').vel)).toBeGreaterThan(29_000);
    expect(length(eph.get('earth').vel)).toBeLessThan(30_600);
  });
});

describe('orientations', () => {
  it("Earth's pole is the celestial pole: ecliptic north tilted by the obliquity", () => {
    eph.update(0);
    const pole = rotate(eph.get('earth').q, [0, 1, 0]);
    expect(angleDeg(pole, [0, 1, 0])).toBeCloseTo((OBLIQUITY_J2000 * 180) / Math.PI, 2);
    expect(pole[2]).toBeLessThan(0); // towards ecliptic longitude 90 degrees (world -Z)
  });

  it('Earth turns once per sidereal day and rotates eastward', () => {
    eph.update(0);
    const a = rotate(eph.get('earth').q, [1, 0, 0]);
    eph.update(86164.0905);
    const b = rotate(eph.get('earth').q, [1, 0, 0]);
    expect(angleDeg(a, b)).toBeLessThan(0.01);
    eph.update(0);
    const pole = rotate(eph.get('earth').q, [0, 1, 0]);
    const x0 = rotate(eph.get('earth').q, [1, 0, 0]);
    eph.update(600);
    const x1 = rotate(eph.get('earth').q, [1, 0, 0]);
    expect(dot(cross(x0, x1), pole)).toBeGreaterThan(0);
  });

  it('the Greenwich meridian is at right ascension ~280 degrees at J2000 (GMST 280.46)', () => {
    eph.update(0);
    const m = rotate(eph.get('earth').q, [1, 0, 0]);
    // world -> ICRF: invert icrfToWorld.
    const ecl: Vec3 = [m[0], -m[2], m[1]];
    const eps = OBLIQUITY_J2000;
    const icrf: Vec3 = [ecl[0], ecl[1] * Math.cos(eps) - ecl[2] * Math.sin(eps), ecl[1] * Math.sin(eps) + ecl[2] * Math.cos(eps)];
    const ra = ((Math.atan2(icrf[1], icrf[0]) * 180) / Math.PI + 360) % 360;
    expect(Math.abs(ra - 280.46)).toBeLessThan(0.6);
  });

  it('Mars, Jupiter and Saturn have their known axial tilts relative to their orbits (25.2, 3.1, 26.7 degrees)', () => {
    const tilt = (id: string) => {
      const t = ut('2000-01-01T12:00:00Z');
      eph.update(t);
      const pole = rotate(eph.get(id).q, [0, 1, 0]);
      const o = eph.orbitOf(id, t)!;
      const normal = rotate(quaternionFromBasis(o.frame.ex, o.frame.ey, o.frame.ez), [0, 0, 1]);
      // Orbit normal: ecliptic normal tilted by inclination about the node; approximate with h = r x v.
      const r = eph.get(id).pos;
      const v = eph.get(id).vel;
      void normal;
      return angleDeg(pole, cross(r, v));
    };
    expect(tilt('mars')).toBeGreaterThan(23);
    expect(tilt('mars')).toBeLessThan(27.5);
    expect(tilt('jupiter')).toBeLessThan(4.5);
    expect(tilt('saturn')).toBeGreaterThan(25);
    expect(tilt('saturn')).toBeLessThan(29);
  });

  it('Venus and Uranus spin retrograde (west) while Earth and Mars spin prograde (east)', () => {
    const spinSign = (id: string) => {
      eph.update(1000);
      const pole = rotate(eph.get(id).q, [0, 1, 0]);
      const x0 = rotate(eph.get(id).q, [1, 0, 0]);
      eph.update(1000 + 300);
      const x1 = rotate(eph.get(id).q, [1, 0, 0]);
      return Math.sign(dot(cross(x0, x1), pole));
    };
    expect(spinSign('venus')).toBe(-1);
    expect(spinSign('uranus')).toBe(-1);
    expect(spinSign('earth')).toBe(1);
    expect(spinSign('mars')).toBe(1);
    expect(spinSign('jupiter')).toBe(1);
  });
});

describe('spheres of influence', () => {
  it('assigns points to the deepest body whose SOI contains them', () => {
    const t = ut('2026-10-08T00:00:00Z');
    eph.update(t);
    const near = (id: string, offset: number): Vec3 => {
      const p = eph.get(id).pos;
      return [p[0] + offset, p[1], p[2]];
    };
    expect(eph.dominantBody(near('earth', 3e8))).toBe('earth');
    expect(eph.dominantBody(near('moon', 1e7))).toBe('moon');
    expect(eph.dominantBody(near('mars', 1e7))).toBe('mars');
    expect(eph.dominantBody(near('io', 5e5))).toBe('io');
    expect(eph.dominantBody(near('titan', 1e6))).toBe('titan');
    expect(eph.dominantBody([2 * AU, 0, 0])).toBe('sun');
    expect(eph.dominantBody(near('earth', 2e9))).toBe('sun'); // beyond Earth's 0.93 million km SOI
  });

  it('SOI radii: Earth ~0.93e9 m, Moon ~6.6e7 m, Jupiter ~4.8e10 m', () => {
    expect(eph.soi.get('earth')! / 1e9).toBeGreaterThan(0.9);
    expect(eph.soi.get('earth')! / 1e9).toBeLessThan(0.96);
    expect(eph.soi.get('moon')! / 1e7).toBeGreaterThan(6.2);
    expect(eph.soi.get('moon')! / 1e7).toBeLessThan(6.9);
    expect(eph.soi.get('jupiter')! / 1e10).toBeGreaterThan(4.7);
    expect(eph.soi.get('jupiter')! / 1e10).toBeLessThan(4.95);
  });
});

describe('frames', () => {
  it('body axes are an orthonormal right-handed basis', () => {
    for (const b of BODIES) {
      const a = bodyAxes(b.rotation.ra, b.rotation.dec, 123.4);
      expect(length(a.x)).toBeCloseTo(1, 12);
      expect(length(a.y)).toBeCloseTo(1, 12);
      expect(length(a.z)).toBeCloseTo(1, 12);
      expect(dot(a.x, a.y)).toBeCloseTo(0, 12);
      expect(dot(a.x, a.z)).toBeCloseTo(0, 12);
      const z = cross(a.x, a.y);
      expect(length(sub(z, a.z))).toBeLessThan(1e-12);
    }
  });

  it('quaternionFromBasis reproduces the basis', () => {
    const a = bodyAxes(40.589, 83.537, 77);
    const q = quaternionFromBasis(a.x, a.y, a.z);
    for (const [src, dst] of [[[1, 0, 0], a.x], [[0, 1, 0], a.y], [[0, 0, 1], a.z]] as Array<[Vec3, Vec3]>) {
      expect(length(sub(rotate(q, src), dst))).toBeLessThan(1e-12);
    }
  });

  it('icrfToWorld sends the celestial pole to the tilted pole and keeps the equinox', () => {
    const pole = icrfToWorld([0, 0, 1]);
    expect(pole[1]).toBeCloseTo(Math.cos(OBLIQUITY_J2000), 12);
    expect(pole[2]).toBeCloseTo(-Math.sin(OBLIQUITY_J2000), 12);
    expect(icrfToWorld([1, 0, 0])).toEqual([1, 0, -0]);
    expect(length(sub(poleWorld(0, 90), pole))).toBeLessThan(1e-12);
  });

  it('equator frames are orthonormal with +Z along the pole', () => {
    const f = equatorFrame(268.056595, 64.495303);
    expect(length(f.ex)).toBeCloseTo(1, 12);
    expect(dot(f.ex, f.ez)).toBeCloseTo(0, 12);
    expect(length(sub(cross(f.ex, f.ey), f.ez))).toBeLessThan(1e-12);
  });
});

/**
 * On-rails ephemeris: position, velocity and orientation of every body as an analytic function of universal time
 * (seconds since J2000), so any date is exact and jumping or warping costs nothing. Heliocentric, world axes.
 * Pure maths: no rendering imports.
 */
import { AU, BODIES, bodyDef, type BodyDef } from '../data/solar-system';
import { bodyAxes, ECLIPTIC_FRAME, equatorFrame, frameToWorld, quaternionFromBasis, type OrbitFrame } from './frames';
import { elementsToState, soiRadius, wrapPi, type Elements, type Vec3 } from './kepler';
import { lunarLongitudePerturbation } from './lunar';

const DEG = Math.PI / 180;
const DAY = 86400;
const CENTURY = 36525 * DAY;

export interface BodyState {
  /** Heliocentric position and velocity in world axes (m, m/s). */
  pos: Vec3;
  vel: Vec3;
  /** Body-fixed -> world rotation as a quaternion [x, y, z, w]. */
  q: [number, number, number, number];
}

/** An orbit about a parent body, ready to draw or propagate. */
export interface OrbitInfo {
  parent: string;
  elements: Elements;
  /** Effective gravitational parameter (m^3/s^2) that reproduces the orbit's mean motion. */
  mu: number;
  frame: OrbitFrame;
}

export class Ephemeris {
  readonly states = new Map<string, BodyState>();
  /** Sphere-of-influence radius about the parent (m); Infinity for the Sun. */
  readonly soi = new Map<string, number>();
  private readonly children = new Map<string, string[]>();
  private readonly orbitScratch = new Map<string, OrbitInfo>();

  constructor() {
    for (const b of BODIES) {
      this.states.set(b.id, { pos: [0, 0, 0], vel: [0, 0, 0], q: [0, 0, 0, 1] });
      if (b.parent) {
        const list = this.children.get(b.parent) ?? [];
        list.push(b.id);
        this.children.set(b.parent, list);
        this.soi.set(b.id, soiRadius(this.semiMajor(b), b.gm, bodyDef(b.parent).gm));
      } else {
        this.soi.set(b.id, Infinity);
      }
    }
    this.update(0);
  }

  get(id: string): BodyState {
    return this.states.get(id)!;
  }

  /** Mean semi-major axis (m) of a body's orbit about its parent. */
  private semiMajor(b: BodyDef): number {
    const o = b.orbit;
    if (!o) return 0;
    if (o.type === 'standish') return o.a[0] * AU;
    if (o.type === 'lunar') return 3.84399e8;
    return o.a;
  }

  /** The orbit of `id` about its parent at universal time `ut` (mean/osculating elements), or null for the Sun. */
  orbitOf(id: string, ut: number): OrbitInfo | null {
    const b = bodyDef(id);
    const spec = b.orbit;
    if (!spec || !b.parent) return null;

    if (spec.type === 'standish') {
      const T = ut / CENTURY;
      const a = (spec.a[0] + spec.a[1] * T) * AU;
      const e = spec.e[0] + spec.e[1] * T;
      const I = (spec.I[0] + spec.I[1] * T) * DEG;
      const L = (spec.L[0] + spec.L[1] * T) * DEG;
      const varpi = (spec.varpi[0] + spec.varpi[1] * T) * DEG;
      const Omega = (spec.Omega[0] + spec.Omega[1] * T) * DEG;
      const n = (spec.L[1] * DEG) / CENTURY; // rad/s (the mean longitude rate)
      const elements: Elements = { a, e, i: I, omegaNode: Omega, omegaPeri: varpi - Omega, M0: wrapPi(L - varpi), epoch: ut };
      return this.fill(id, b.parent, elements, n * n * a * a * a, ECLIPTIC_FRAME);
    }

    if (spec.type === 'lunar') {
      const d = ut / DAY;
      const L = (218.316 + 13.176396 * d) * DEG;
      const varpi = (83.353 + 0.1114041 * d) * DEG;
      const Omega = (125.044 - 0.0529538 * d) * DEG;
      const a = 3.84399e8;
      const pert = lunarLongitudePerturbation(ut);
      const n = ((13.176396 - 0.1114041) * DEG) / DAY + pert.rate; // anomalistic motion, plus the perturbation's rate
      const elements: Elements = { a, e: 0.0549, i: 5.145 * DEG, omegaNode: Omega, omegaPeri: varpi - Omega, M0: wrapPi(L + pert.dL - varpi), epoch: ut };
      return this.fill(id, b.parent, elements, n * n * a * a * a, ECLIPTIC_FRAME);
    }

    const parent = bodyDef(b.parent);
    const mu = parent.gm + b.gm;
    const n = Math.sqrt(mu / (spec.a * spec.a * spec.a));
    const elements: Elements = {
      a: spec.a,
      e: spec.e,
      i: spec.i * DEG,
      omegaNode: spec.node * DEG,
      omegaPeri: spec.peri * DEG,
      M0: wrapPi(spec.M0 * DEG + n * ut),
      epoch: ut,
    };
    const frame = spec.frame === 'ecliptic' ? ECLIPTIC_FRAME : equatorFrame(parent.rotation.ra, parent.rotation.dec);
    return this.fill(id, b.parent, elements, mu, frame);
  }

  private fill(id: string, parent: string, elements: Elements, mu: number, frame: OrbitFrame): OrbitInfo {
    let info = this.orbitScratch.get(id);
    if (!info) {
      info = { parent, elements, mu, frame };
      this.orbitScratch.set(id, info);
    } else {
      info.elements = elements;
      info.mu = mu;
      info.frame = frame;
    }
    return info;
  }

  /** Position/velocity of `id` relative to its parent (world axes). */
  private relativeState(id: string, ut: number): { r: Vec3; v: Vec3 } {
    const o = this.orbitOf(id, ut)!;
    const s = elementsToState(o.elements, o.mu, ut);
    return { r: frameToWorld(o.frame, s.r), v: frameToWorld(o.frame, s.v) };
  }

  /**
   * Heliocentric state of `id` at `ut`, computed on demand without touching the shared pose (so predictions can look into the
   * future while the scene keeps drawing the present). Same result as `update(ut)` followed by `get(id)`.
   */
  stateAt(id: string, ut: number): { pos: Vec3; vel: Vec3 } {
    if (id === 'sun') return { pos: [0, 0, 0], vel: [0, 0, 0] };
    const earthMoon = bodyDef('moon').gm / (bodyDef('earth').gm + bodyDef('moon').gm);
    if (id === 'earth') {
      const emb = this.relativeState('earth', ut);
      const m = this.relativeState('moon', ut);
      return {
        pos: [emb.r[0] - earthMoon * m.r[0], emb.r[1] - earthMoon * m.r[1], emb.r[2] - earthMoon * m.r[2]],
        vel: [emb.v[0] - earthMoon * m.v[0], emb.v[1] - earthMoon * m.v[1], emb.v[2] - earthMoon * m.v[2]],
      };
    }
    const parent = this.stateAt(bodyDef(id).parent!, ut);
    const rel = this.relativeState(id, ut);
    return { pos: [parent.pos[0] + rel.r[0], parent.pos[1] + rel.r[1], parent.pos[2] + rel.r[2]], vel: [parent.vel[0] + rel.v[0], parent.vel[1] + rel.v[1], parent.vel[2] + rel.v[2]] };
  }

  /** Position and velocity of `id` relative to its parent body at `ut` (world axes). Earth is measured from the Sun, wobble included. */
  relative(id: string, ut: number): { pos: Vec3; vel: Vec3 } {
    if (id === 'earth') return this.stateAt('earth', ut);
    const s = this.relativeState(id, ut);
    return { pos: s.r, vel: s.v };
  }

  /** Move every body to universal time `ut`. */
  update(ut: number): void {
    const days = ut / DAY;
    const earthMoon = bodyDef('moon').gm / (bodyDef('earth').gm + bodyDef('moon').gm);
    let moonRel: { r: Vec3; v: Vec3 } | null = null;

    for (const b of BODIES) {
      const st = this.states.get(b.id)!;
      if (b.id === 'sun') {
        st.pos = [0, 0, 0];
        st.vel = [0, 0, 0];
      } else if (b.id === 'earth') {
        // The elements describe the Earth-Moon barycentre; Earth wobbles around it opposite the Moon.
        const emb = this.relativeState('earth', ut);
        moonRel = this.relativeState('moon', ut);
        st.pos = [emb.r[0] - earthMoon * moonRel.r[0], emb.r[1] - earthMoon * moonRel.r[1], emb.r[2] - earthMoon * moonRel.r[2]];
        st.vel = [emb.v[0] - earthMoon * moonRel.v[0], emb.v[1] - earthMoon * moonRel.v[1], emb.v[2] - earthMoon * moonRel.v[2]];
      } else if (b.id === 'moon') {
        const earth = this.states.get('earth')!;
        const m = moonRel!;
        st.pos = [earth.pos[0] + m.r[0], earth.pos[1] + m.r[1], earth.pos[2] + m.r[2]];
        st.vel = [earth.vel[0] + m.v[0], earth.vel[1] + m.v[1], earth.vel[2] + m.v[2]];
      } else {
        const rel = this.relativeState(b.id, ut);
        const parent = this.states.get(b.parent!)!;
        st.pos = [parent.pos[0] + rel.r[0], parent.pos[1] + rel.r[1], parent.pos[2] + rel.r[2]];
        st.vel = [parent.vel[0] + rel.v[0], parent.vel[1] + rel.v[1], parent.vel[2] + rel.v[2]];
      }
      const w = (b.rotation.w0 + b.rotation.wdot * days) % 360;
      const axes = bodyAxes(b.rotation.ra, b.rotation.dec, w);
      st.q = quaternionFromBasis(axes.x, axes.y, axes.z);
    }
  }

  /** The deepest body whose sphere of influence contains `pos` (heliocentric world coordinates). */
  dominantBody(pos: Vec3): string {
    let current = 'sun';
    for (;;) {
      let next: string | null = null;
      for (const child of this.children.get(current) ?? []) {
        const c = this.states.get(child)!.pos;
        if (Math.hypot(pos[0] - c[0], pos[1] - c[1], pos[2] - c[2]) < this.soi.get(child)!) {
          next = child;
          break;
        }
      }
      if (!next) return current;
      current = next;
    }
  }

  childrenOf(id: string): readonly string[] {
    return this.children.get(id) ?? [];
  }
}

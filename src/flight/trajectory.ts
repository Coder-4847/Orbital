/**
 * Patched-conic trajectory prediction. From a vessel's state about one body this follows the Kepler orbit forward, applies any
 * maneuver nodes, and stops at the next event: leaving the body's sphere of influence, entering a moon's or planet's sphere of
 * influence, or hitting the ground. Each event starts a new patch in the neighbouring body's frame, up to a limit. Orbit
 * crossings are found analytically from the apsides (radius is monotonic between them); encounters by a conservative stepping
 * that cannot skip over a sphere of influence. Pure maths, no rendering.
 */
import { bodyDef } from '../data/solar-system';
import type { Ephemeris } from '../physics/ephemeris';
import { add, length, meanMotion, orbitalPeriod, propagate, stateToElements, sub, TWO_PI, type Elements, type Vec3 } from '../physics/kepler';
import { nodeDeltaV, type ManeuverNode } from './maneuver';

export type PatchEnd = 'soi-exit' | 'soi-enter' | 'impact' | 'node' | 'horizon';

export interface NavModel {
  ephemeris: Ephemeris;
  /** Altitude (m) below which the vessel needs full physics (top of the atmosphere, or clear of mountains). */
  floor(id: string): number;
}

export interface Patch {
  body: string;
  mu: number;
  radius: number;
  startUt: number;
  endUt: number;
  /** State relative to the body at the start and the end of the patch. */
  r0: Vec3;
  v0: Vec3;
  r1: Vec3;
  v1: Vec3;
  end: PatchEnd;
  /** The body entered at the end of a 'soi-enter' / 'soi-exit' patch. */
  next: string | null;
  /** First time the vessel is below the rails floor (full physics needed from then on), if within the patch. */
  floorUt: number | null;
  /** Node applied at the end of a 'node' patch. */
  nodeId: number | null;
  elements: Elements;
  bound: boolean;
  period: number;
}

export interface Trajectory {
  patches: Patch[];
  /** Universal time the prediction starts at. */
  startUt: number;
}

export interface StartState {
  body: string;
  r: Vec3;
  v: Vec3;
  ut: number;
}

export interface PredictOptions {
  maxPatches?: number;
  /** Closed orbits are followed for this many periods; open ones for up to `maxHorizon` seconds. */
  maxOrbits?: number;
  maxHorizon?: number;
}

const YEAR = 365.25 * 86400;
const MIN_STEP = 2;
const SAFETY = 0.45;
/** A vessel just handed over from a child's sphere of influence sits on its edge: it must be this far inside (m) to count as entering. */
const ENTER_MARGIN = 1;
/** Open orbits are followed out to this distance from the body (m): well past the planets, the end of the map. */
const FAR_RADIUS = 3e13;

export const patchState = (p: Patch, ut: number): { r: Vec3; v: Vec3 } => propagate({ r: p.r0, v: p.v0 }, p.mu, ut - p.startUt);

/** Bisect a monotonic predicate flip between times `a` (false) and `b` (true); returns the time just inside `true`. */
function bisect(a: number, b: number, inside: (t: number) => boolean): number {
  let lo = a;
  let hi = b;
  for (let i = 0; i < 70 && hi - lo > 1e-4; i++) {
    const mid = 0.5 * (lo + hi);
    if (inside(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Times of the next periapsis and apoapsis at or after `ut` for an orbit with elements `el` (epoch `ut0`); apoapsis is Infinity if open. */
export function apsisTimes(el: Elements, mu: number, ut0: number, ut: number): { pe: number; ap: number } {
  const n = meanMotion(el.a, mu);
  if (el.e < 1) {
    const m = (el.M0 + n * (ut - ut0)) % TWO_PI;
    const mm = m < 0 ? m + TWO_PI : m; // 0..2pi
    const toPe = ((TWO_PI - mm) % TWO_PI) / n;
    const toAp = ((((Math.PI - mm) % TWO_PI) + TWO_PI) % TWO_PI) / n;
    return { pe: ut + toPe, ap: ut + toAp };
  }
  const m = el.M0 + n * (ut - ut0);
  return { pe: m <= 0 ? ut - m / n : Infinity, ap: Infinity };
}

interface Event {
  t: number;
  kind: PatchEnd;
  next: string | null;
}

/** Follow one conic from `t0` until the first event before the node time `tNode` or the prediction horizon. */
function buildPatch(model: NavModel, body: string, r0: Vec3, v0: Vec3, t0: number, tNode: number, opts: PredictOptions): Patch {
  const def = bodyDef(body);
  const mu = def.gm;
  const radius = def.radius;
  const eph = model.ephemeris;
  const el = stateToElements({ r: r0, v: v0 }, mu, t0);
  const bound = el.e < 1 && el.a > 0;
  const period = bound ? orbitalPeriod(el.a, mu) : Infinity;
  const soi = eph.soi.get(body) ?? Infinity;
  const n = meanMotion(el.a, mu);
  /** Times at which an open orbit is at radius `rt`: [inbound, outbound]. Analytic, so huge distances stay well-conditioned. */
  const openCrossings = (rt: number): number[] => {
    const a = -el.a;
    const rp = a * (el.e - 1);
    if (rt < rp) return [];
    const H = Math.acosh(Math.max(1, (rt / a + 1) / el.e));
    const dM = (el.e * Math.sinh(H) - H) / n;
    const tpe = t0 - el.M0 / n;
    return [tpe - dM, tpe + dM];
  };
  let horizon = bound ? period * (opts.maxOrbits ?? 8) : (opts.maxHorizon ?? 30 * YEAR);
  if (Number.isFinite(tNode)) horizon = Math.max(horizon, Math.min(tNode - t0, 5 * YEAR)); // always reach the next node
  if (!bound) {
    const far = openCrossings(FAR_RADIUS)[1];
    if (far !== undefined && far > t0) horizon = Math.min(horizon, far - t0);
  }
  const nodeFirst = tNode <= t0 + horizon;
  const tEnd = Math.min(t0 + horizon, tNode);
  const state = (t: number) => propagate({ r: r0, v: v0 }, mu, t - t0);
  const radiusAt = (t: number) => length(state(t).r);
  const rStart = length(r0);

  // Breakpoints where the radius is monotonic: the apsides. Closed orbits repeat, so one period is enough to find a crossing.
  const breaks: number[] = [t0];
  const aps = apsisTimes(el, mu, t0, t0);
  if (bound) {
    const scanEnd = Math.min(tEnd, t0 + period * 1.001);
    const first = [aps.pe, aps.ap].filter((x) => x > t0 && x < scanEnd).sort((a, b) => a - b);
    breaks.push(...first);
    const second = first.length > 0 ? first[first.length - 1]! + period / 2 : Infinity;
    if (second < scanEnd) breaks.push(second);
    breaks.push(scanEnd);
  }
  const firstCrossing = (rt: number): number | null => {
    if (!bound) {
      const hit = openCrossings(rt).filter((t) => t >= t0 - 1e-6 && t <= tEnd).sort((x, y) => x - y)[0];
      return hit === undefined ? null : Math.max(hit, t0);
    }
    for (let i = 0; i + 1 < breaks.length; i++) {
      const a = breaks[i]!;
      const b = breaks[i + 1]!;
      const fa = radiusAt(a) - rt;
      const fb = radiusAt(b) - rt;
      if (fa === 0) return a;
      if (fa * fb <= 0) return bisect(a, b, fa > 0 ? (t) => radiusAt(t) <= rt : (t) => radiusAt(t) >= rt);
    }
    return null;
  };

  let event: Event = { t: tEnd, kind: nodeFirst ? 'node' : 'horizon', next: null };

  // Ground, rails floor, sphere-of-influence exit.
  const floorR = radius + model.floor(body);
  const floorUt = rStart <= floorR ? t0 : firstCrossing(floorR);
  if (rStart <= radius) event = { t: t0, kind: 'impact', next: null };
  else if (floorUt !== null) {
    const hit = firstCrossing(radius);
    if (hit !== null && hit < event.t) event = { t: hit, kind: 'impact', next: null };
  }
  if (Number.isFinite(soi)) {
    const out = firstCrossing(soi);
    if (out !== null && out < event.t) event = { t: out, kind: 'soi-exit', next: def.parent };
  }

  // Entering the sphere of influence of a child body: conservative stepping that cannot jump over it.
  const children = eph.childrenOf(body);
  if (children.length > 0 && event.t > t0) {
    const limit = event.t;
    const cap = bound ? period / 48 : Math.max(3600, rStart / Math.max(length(v0), 1) / 2);
    let t = t0;
    let prev = t0;
    let hit: { id: string; t: number } | null = null;
    while (t < limit && !hit) {
      const s = state(t);
      let step = cap;
      let inside: string | null = null;
      for (const c of children) {
        const rel = eph.relative(c, t);
        const sc = eph.soi.get(c)!;
        const d = length(sub(s.r, rel.pos));
        if (d < sc - ENTER_MARGIN) {
          inside = c;
          break;
        }
        const vrel = length(sub(s.v, rel.vel)) * 1.5 + 1;
        step = Math.min(step, Math.max(MIN_STEP, (SAFETY * (d - sc + ENTER_MARGIN)) / vrel));
      }
      if (inside) {
        const c = inside;
        const sc = eph.soi.get(c)!;
        const inSoi = (tt: number) => length(sub(state(tt).r, eph.relative(c, tt).pos)) < sc - ENTER_MARGIN;
        hit = { id: c, t: t === t0 ? t0 : bisect(prev, t, inSoi) };
        break;
      }
      prev = t;
      t += step;
    }
    if (hit && hit.t < event.t) event = { t: hit.t, kind: 'soi-enter', next: hit.id };
  }

  const end = state(event.t);
  return {
    body,
    mu,
    radius,
    startUt: t0,
    endUt: event.t,
    r0,
    v0,
    r1: end.r,
    v1: end.v,
    end: event.kind,
    next: event.next,
    floorUt: floorUt !== null && floorUt <= event.t ? floorUt : null,
    nodeId: null,
    elements: el,
    bound,
    period,
  };
}

/** Predict the path from `start`, applying `nodes`, for up to `opts.maxPatches` patches (default 8). */
export function predictTrajectory(model: NavModel, start: StartState, nodes: readonly ManeuverNode[], opts: PredictOptions = {}): Trajectory {
  const patches: Patch[] = [];
  const pending = nodes.filter((n) => n.ut > start.ut).sort((a, b) => a.ut - b.ut);
  let { body, r, v } = start;
  let t0 = start.ut;
  for (let k = 0; k < (opts.maxPatches ?? 8); k++) {
    while (pending.length > 0 && pending[0]!.ut <= t0) pending.shift();
    const node = pending[0];
    const patch = buildPatch(model, body, r, v, t0, node ? node.ut : Infinity, opts);
    patches.push(patch);
    if (patch.end === 'node' && node) {
      patch.nodeId = node.id;
      pending.shift();
      r = patch.r1;
      v = add(patch.v1, nodeDeltaV(node, patch.r1, patch.v1));
      t0 = patch.endUt;
      continue;
    }
    if ((patch.end === 'soi-enter' || patch.end === 'soi-exit') && patch.next) {
      const eph = model.ephemeris;
      const t = patch.endUt;
      if (patch.end === 'soi-enter') {
        const rel = eph.relative(patch.next, t);
        r = sub(patch.r1, rel.pos);
        v = sub(patch.v1, rel.vel);
      } else {
        const rel = eph.relative(body, t);
        r = add(patch.r1, rel.pos);
        v = add(patch.v1, rel.vel);
      }
      body = patch.next;
      t0 = t;
      continue;
    }
    break;
  }
  return { patches, startUt: start.ut };
}

export interface Approach {
  ut: number;
  distance: number;
  /** Vessel and target positions relative to the patch's body at that time. */
  vessel: Vec3;
  target: Vec3;
}

/** Closest approach of a patch's path to `target`, a child of the patch's body (null if it is not one). */
export function closestApproach(model: NavModel, patch: Patch, target: string): Approach | null {
  const eph = model.ephemeris;
  if (bodyDef(target).parent !== patch.body) return null;
  const dist = (t: number): number => length(sub(patchState(patch, t).r, eph.relative(target, t).pos));
  const span = patch.endUt - patch.startUt;
  if (!(span > 0)) return null;
  const samples = 600;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= samples; i++) {
    const d = dist(patch.startUt + (span * i) / samples);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  let lo = patch.startUt + (span * Math.max(0, best - 1)) / samples;
  let hi = patch.startUt + (span * Math.min(samples, best + 1)) / samples;
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 60 && hi - lo > 0.5; i++) {
    const a = hi - phi * (hi - lo);
    const b = lo + phi * (hi - lo);
    if (dist(a) < dist(b)) hi = b;
    else lo = a;
  }
  const ut = 0.5 * (lo + hi);
  return { ut, distance: dist(ut), vessel: patchState(patch, ut).r, target: eph.relative(target, ut).pos };
}

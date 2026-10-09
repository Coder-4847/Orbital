/**
 * Navigation for the active vessel: its maneuver nodes, the predicted patched-conic trajectory, the targets and markers the map
 * shows, and time warp on rails (analytic Kepler propagation with sphere-of-influence hand-overs and safe stopping). Pure maths:
 * it reads a FlightWorld and never draws anything.
 */
import { bodyDef } from '../data/solar-system';
import { add, scale, stateToElements, sub, type Vec3 } from '../physics/kepler';
import type { FlightWorld } from './flight-world';
import { burnEstimate, burnFrame, nodeDeltaV, nodeMagnitude, type ManeuverNode } from './maneuver';
import { altitudeOf } from './env';
import { apsisTimes, closestApproach, patchState, predictTrajectory, type Approach, type NavModel, type Trajectory } from './trajectory';

export type WarpEvent = 'node' | 'apoapsis' | 'periapsis' | 'soi';

export interface RailsResult {
  /** Why the warp had to stop early, or null if the whole interval was covered. */
  stopped: 'floor' | 'impact' | null;
  /** The body entered during the interval, if any. */
  entered: string | null;
}

export interface MarkerPoint {
  kind: 'apoapsis' | 'periapsis' | 'soi-enter' | 'soi-exit' | 'impact' | 'node' | 'closest';
  /** Patch the marker belongs to and its time and body-relative position. */
  patch: number;
  ut: number;
  r: Vec3;
  label: string;
  nodeId?: number;
}

/** What a node will do to the orbit, kept so a burn can be flown to completion after the node time has passed. */
interface NodePlan {
  body: string;
  /** State right after the impulse (body-relative) at `ut`, and the impulse itself. */
  r: Vec3;
  v: Vec3;
  ut: number;
  mu: number;
  dv: Vec3;
  /** The burn as unit components along prograde / normal / radial, and the vessel's `dvSpent` while it was last idle. */
  parts: Vec3;
  base: number;
  /** True once the engine has started adding to this burn. */
  started: boolean;
}

export class Navigator {
  nodes: ManeuverNode[] = [];
  private readonly plans = new Map<number, NodePlan>();
  /** A body the player wants to reach: closest approach to it is marked. */
  target: string | null = null;
  trajectory: Trajectory | null = null;
  private nextId = 1;
  private stamp = { version: -1, nodesRev: -1, body: '', refreshedAt: -Infinity };
  private nodesRev = 0;
  private readonly model: NavModel;

  constructor(private readonly world: () => FlightWorld) {
    const get = world;
    this.model = {
      get ephemeris() {
        return get().host!.ephemeris;
      },
      floor: (id) => get().envOf(id).railsFloor ?? 15_000,
    };
  }

  // ------------------------------------------------------------------ nodes

  addNode(ut: number, dv: { prograde?: number; normal?: number; radial?: number } = {}): ManeuverNode {
    const node: ManeuverNode = { id: this.nextId++, ut, prograde: dv.prograde ?? 0, normal: dv.normal ?? 0, radial: dv.radial ?? 0 };
    this.nodes.push(node);
    this.nodesRev++;
    return node;
  }

  /** Replace the nodes and target (loading a save). */
  restore(nodes: readonly ManeuverNode[], target: string | null): void {
    this.nodes = nodes.map((n) => ({ ...n }));
    this.nextId = Math.max(0, ...this.nodes.map((n) => n.id)) + 1;
    this.plans.clear();
    this.target = target;
    this.nodesRev++;
  }

  updateNode(id: number, change: Partial<Omit<ManeuverNode, 'id'>>): void {
    const n = this.nodes.find((x) => x.id === id);
    if (!n) return;
    Object.assign(n, change);
    this.nodesRev++;
  }

  removeNode(id: number): void {
    this.nodes = this.nodes.filter((n) => n.id !== id);
    this.plans.delete(id);
    this.nodesRev++;
  }

  clearNodes(): void {
    this.nodes = [];
    this.plans.clear();
    this.nodesRev++;
  }

  setTarget(id: string | null): void {
    this.target = id;
    this.nodesRev++;
  }

  // ------------------------------------------------------------------ prediction

  /** Recompute the predicted trajectory when the vessel, the nodes or the body changed (and at most every `interval` s of real time). */
  refresh(now: number, interval = 0.25, force = false): Trajectory | null {
    const world = this.world();
    const v = world.active;
    if (!v || !world.host) {
      this.trajectory = null;
      return null;
    }
    const s = this.stamp;
    const stale = s.version !== world.version || s.nodesRev !== this.nodesRev || s.body !== world.bodyId || !this.trajectory;
    if (!force && !stale) return this.trajectory;
    if (!force && s.nodesRev === this.nodesRev && s.body === world.bodyId && now - s.refreshedAt < interval && this.trajectory) return this.trajectory;
    this.trajectory = predictTrajectory(this.model, { body: world.bodyId, r: v.pos, v: v.vel, ut: world.ut }, this.nodes);
    this.trajectory.patches.forEach((p, i) => {
      const after = this.trajectory!.patches[i + 1];
      if (p.nodeId === null || !after) return;
      const node = this.nodes.find((n) => n.id === p.nodeId);
      if (!node) return;
      const mag = nodeMagnitude(node) || 1;
      const old = this.plans.get(node.id);
      const base = old && old.body === after.body ? old.base : (world.active?.dvSpent ?? 0);
      this.plans.set(node.id, { body: after.body, r: after.r0, v: after.v0, ut: after.startUt, mu: after.mu, dv: nodeDeltaV(node, p.r1, p.v1), parts: [node.prograde / mag, node.normal / mag, node.radial / mag], base, started: old && old.body === after.body ? old.started : false });
    });
    this.stamp = { version: world.version, nodesRev: this.nodesRev, body: world.bodyId, refreshedAt: now };
    return this.trajectory;
  }

  /** Markers for the map: apsides, node points, sphere-of-influence changes, impact, closest approach to the target. */
  markers(): MarkerPoint[] {
    const traj = this.trajectory;
    const world = this.world();
    if (!traj) return [];
    const out: MarkerPoint[] = [];
    traj.patches.forEach((p, i) => {
      const from = Math.max(p.startUt, world.ut);
      const aps = apsisTimes(p.elements, p.mu, p.startUt, from);
      if (aps.pe <= p.endUt) out.push({ kind: 'periapsis', patch: i, ut: aps.pe, r: patchState(p, aps.pe).r, label: 'Pe' });
      if (p.bound && aps.ap <= p.endUt) out.push({ kind: 'apoapsis', patch: i, ut: aps.ap, r: patchState(p, aps.ap).r, label: 'Ap' });
      const nextBody = p.next ? bodyDef(p.next).name : '';
      if (p.end === 'soi-enter') out.push({ kind: 'soi-enter', patch: i, ut: p.endUt, r: p.r1, label: `${nextBody} encounter` });
      if (p.end === 'soi-exit') out.push({ kind: 'soi-exit', patch: i, ut: p.endUt, r: p.r1, label: `Leave for ${nextBody}` });
      if (p.end === 'impact') out.push({ kind: 'impact', patch: i, ut: p.endUt, r: p.r1, label: 'Impact' });
      if (p.end === 'node' && p.nodeId !== null) out.push({ kind: 'node', patch: i, ut: p.endUt, r: p.r1, label: 'Maneuver', nodeId: p.nodeId });
      if (this.target) {
        const ap = closestApproach(this.model, p, this.target);
        if (ap) out.push({ kind: 'closest', patch: i, ut: ap.ut, r: ap.vessel, label: `Closest approach to ${bodyDef(this.target).name}` });
      }
    });
    return out;
  }

  closestApproachToTarget(): (Approach & { patch: number }) | null {
    const traj = this.trajectory;
    if (!traj || !this.target) return null;
    let best: (Approach & { patch: number }) | null = null;
    traj.patches.forEach((p, patch) => {
      const a = closestApproach(this.model, p, this.target!);
      if (a && (!best || a.distance < best.distance)) best = { ...a, patch };
    });
    return best;
  }

  /** Universal time of the next warp event of the given kind, or null if there is none. */
  nextEvent(kind: WarpEvent): number | null {
    const traj = this.trajectory;
    const world = this.world();
    if (!traj) return null;
    const now = world.ut;
    for (const p of traj.patches) {
      if (p.endUt <= now) continue;
      if (kind === 'soi' && (p.end === 'soi-enter' || p.end === 'soi-exit')) return p.endUt;
      if (kind === 'node' && p.end === 'node') {
        const node = this.nodes.find((n) => n.id === p.nodeId);
        const v = world.active;
        const burn = node && v ? burnEstimate(v).burnTime(nodeMagnitude(node)) : 0;
        return p.endUt - (Number.isFinite(burn) ? burn / 2 : 0) - 10;
      }
      if (kind === 'apoapsis' || kind === 'periapsis') {
        const aps = apsisTimes(p.elements, p.mu, p.startUt, Math.max(now, p.startUt));
        const t = kind === 'apoapsis' ? aps.ap : aps.pe;
        if (Number.isFinite(t) && t > now + 1 && t <= p.endUt) return t;
      }
    }
    return null;
  }

  /** Time of the next apoapsis or periapsis of the vessel's present orbit (ignoring nodes), or null if it has none. */
  apsisTime(kind: 'apoapsis' | 'periapsis'): number | null {
    const world = this.world();
    const v = world.active;
    if (!v) return null;
    const el = stateToElements({ r: v.pos, v: v.vel }, world.env.mu, world.ut);
    const aps = apsisTimes(el, world.env.mu, world.ut, world.ut);
    const t = kind === 'apoapsis' ? aps.ap : aps.pe;
    return Number.isFinite(t) && t > world.ut + 1 ? t : null;
  }

  // ------------------------------------------------------------------ rails

  /** Why time warp on rails is not possible right now, or null if it is. */
  railsBlocker(): string | null {
    const world = this.world();
    const v = world.active;
    if (!v) return null;
    if (v.tele.thrust > 0 || (v.throttle > 0 && v.parts.some((p) => p.ignited && p.def.engine))) return 'Engines are running';
    if (v.situation === 'rest') return null;
    if (world.cheats.zeroGravity) return 'Gravity is switched off';
    if (world.cheats.maxWarp) return null;
    const floor = world.env.railsFloor ?? 15_000;
    if (altitudeOf(world.env, v.pos) < floor) return `Too low for time warp (below ${(floor / 1000).toFixed(0)} km)`;
    return null;
  }

  /**
   * Advance the world by `dt` seconds on rails. The prediction tells where the orbit changes body or reaches the air or ground:
   * the move stops there ('floor' or 'impact'), and sphere-of-influence changes are carried out on the way.
   */
  advanceRails(dt: number, now = 0): RailsResult {
    const world = this.world();
    const result: RailsResult = { stopped: null, entered: null };
    const v = world.active;
    if (!v || v.situation === 'rest' || !world.host) {
      world.railsMove(dt);
      return result;
    }
    let remaining = dt;
    for (let guard = 0; guard < 12 && remaining > 1e-6; guard++) {
      const traj = this.refresh(now, 0, false);
      const p = traj?.patches[0];
      if (!p) {
        world.railsMove(remaining);
        break;
      }
      let step = remaining;
      let stop: 'floor' | 'impact' | 'soi' | null = null;
      if (p.floorUt !== null && !world.cheats.maxWarp && p.floorUt - world.ut <= step + 1e-3) {
        step = Math.max(0, p.floorUt - world.ut);
        stop = 'floor';
      } else if ((p.end === 'soi-enter' || p.end === 'soi-exit') && p.endUt - world.ut <= step + 1e-3) {
        step = Math.max(0, p.endUt - world.ut);
        stop = 'soi';
      } else if (p.end === 'impact' && p.endUt - world.ut <= step + 1e-3) {
        step = Math.max(0, p.endUt - world.ut);
        stop = 'impact';
      }
      world.railsMove(step);
      remaining -= step;
      if (stop === 'soi' && p.next) {
        world.switchBody(p.next);
        result.entered = p.next;
        this.refresh(now, 0, true);
      } else if (stop === 'floor' || stop === 'impact') {
        result.stopped = stop;
        break;
      }
    }
    return result;
  }

  // ------------------------------------------------------------------ burn guidance

  /** The node about to be (or being) flown: the first one whose time has not long passed. */
  activeNode(): ManeuverNode | null {
    const world = this.world();
    const sorted = [...this.nodes].sort((a, b) => a.ut - b.ut);
    return sorted.find((n) => n.ut > world.ut - 3600) ?? null;
  }

  /**
   * Velocity still to be added to complete `node` (inertial axes, body frame), from the planned post-burn orbit propagated to now
   * minus the actual velocity; null while the vessel is in a different patch than the node's.
   */
  remainingBurn(node: ManeuverNode): Vec3 | null {
    const world = this.world();
    const v = world.active;
    const plan = this.plans.get(node.id);
    if (!v || !plan || plan.body !== world.bodyId) return null;
    if (!plan.started) {
      if (v.tele.thrust > 0) plan.started = true;
      else plan.base = v.dvSpent; // nothing flown yet
    }
    if (!plan.started) return plan.dv; // the planned impulse, until the engine has added something
    const remaining = Math.max(0, nodeMagnitude(node) - (v.dvSpent - plan.base));
    const f = burnFrame(v.pos, v.vel);
    return add(add(scale(f.prograde, plan.parts[0] * remaining), scale(f.normal, plan.parts[1] * remaining)), scale(f.radial, plan.parts[2] * remaining));
  }

  /** Planned delta-v of the node as a vector for the burn direction on the navball. */
  nodeVector(node: ManeuverNode): Vec3 | null {
    const traj = this.trajectory;
    if (!traj) return null;
    const p = traj.patches.find((x) => x.nodeId === node.id);
    return p ? nodeDeltaV(node, p.r1, p.v1) : null;
  }

  /**
   * Where each patch is drawn (heliocentric world axes): the first about its body's position now, an encounter about the body's
   * position relative to the previous patch's body at the time it happens, a departure back out about the parent (the Sun's
   * patch sits at the origin). Patches then join up in the picture at the scale of the body they belong to.
   */
  patchAnchors(): Vec3[] {
    const traj = this.trajectory;
    const world = this.world();
    if (!traj || !world.host) return [];
    const eph = world.host.ephemeris;
    const out: Vec3[] = [];
    traj.patches.forEach((p, i) => {
      if (i === 0) {
        out.push([...eph.get(p.body).pos] as Vec3);
        return;
      }
      const prev = traj.patches[i - 1]!;
      if (p.body === prev.body) out.push(out[i - 1]!); // after a burn: the same orbit frame
      else if (p.body === 'sun') out.push([0, 0, 0]);
      else if (bodyDef(p.body).parent === prev.body) out.push(add(out[i - 1]!, eph.relative(p.body, p.startUt).pos));
      else out.push(sub(out[i - 1]!, eph.relative(prev.body, p.startUt).pos)); // the parent of the previous body
    });
    return out;
  }
}

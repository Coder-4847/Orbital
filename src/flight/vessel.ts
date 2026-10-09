/**
 * A vessel in flight: the parts of a craft with their runtime state (fuel, engines, chutes, legs), the rigid-body state, the
 * mass properties derived from the parts, and the operations that change its structure (staging and breakage split it into
 * several vessels). Pure data and maths: no rendering imports.
 *
 * Frames: the body frame is the craft frame (+Y towards the nose, X/Z across). Kinematics are in the planet-centred inertial
 * frame; `pos` is the centre of mass, and parts sit at `pos + R(q) (partPos - com)`.
 */
import { buildTree, rotate, type Craft, type PartInstance } from '../builder/craft';
import { partDef } from '../builder/part-library';
import type { PartDef } from '../builder/part-types';
import { mat3Inverse, qrot, vsub, QIDENTITY, type Mat3, type Quat, type V3 } from './math3';

export type ChuteState = 'stowed' | 'armed' | 'deploying' | 'deployed' | 'cut';

export interface FlightPart {
  id: string;
  def: PartDef;
  /** Position in the craft frame, and orientation (yaw about Y, optional half turn about X). */
  pos: V3;
  yaw: number;
  flip: boolean;
  /** The craft's attachment data (undirected graph edges), kept so exposure can be recomputed after parts leave. */
  link: { parent: string | null; parentNode: string | null; node: string | null };
  stage: number;
  dry: number;
  fuel: number;
  ignited: boolean;
  /** How hard the engine is burning right now (0..1: throttle times the share of propellant it is getting). For effects. */
  burn: number;
  chute: ChuteState;
  chuteDeploy: number;
  /** 0 = retracted, 1 = fully extended. */
  leg: number;
  /** Skin temperature (K), driven by aerodynamic heating (see heating.ts). */
  temperature: number;
  /** Ablative material left on a heat shield (kg, part of `dry`): it burns away carrying the heat with it. */
  ablator: number;
}

export type SasMode = 'stability' | 'prograde' | 'retrograde' | 'normal' | 'antinormal' | 'radialIn' | 'radialOut' | 'maneuver';

export interface Controls {
  /** Torque requests in -1..1. pitch > 0 tips the nose towards body +X, yaw > 0 towards body +Z, roll > 0 spins about +Y. */
  pitch: number;
  yaw: number;
  roll: number;
  /** RCS translation along body X, Y, Z in -1..1. */
  tx: number;
  ty: number;
  tz: number;
}

export interface MassProps {
  mass: number;
  com: V3;
  inertia: Mat3;
  invInertia: Mat3;
}

export type Situation = 'rest' | 'flying' | 'destroyed';

/** Readouts the physics updates every step for the HUD and effects. */
export interface Telemetry {
  /** Dynamic pressure (Pa), Mach number, angle of attack (rad), felt acceleration in g. */
  q: number;
  mach: number;
  aoa: number;
  gForce: number;
  thrust: number;
  engines: number;
  /** Air density (kg/m^3) and pressure (Pa) at the vessel. */
  density: number;
  pressure: number;
  /** Height of the lowest contact point above the ground (m). */
  clearance: number;
  /** Worst joint load as a fraction of its strength. */
  stress: number;
  /** Unit vector (body frame) of the velocity relative to the air: parachute canopies stream the opposite way. */
  airflow: V3;
  /** Hottest part as a fraction of its limit (1 = burning up) and the strongest heat flux on any part (W/m^2). */
  heat: number;
  heatFlux: number;
}

export interface Vessel {
  id: number;
  name: string;
  debris: boolean;
  parts: FlightPart[];
  rootId: string;

  pos: V3;
  vel: V3;
  q: Quat;
  /** Angular velocity in the body frame (rad/s). */
  w: V3;
  mass: MassProps;

  situation: Situation;
  /** While at rest: pose in the planet's body-fixed frame (the vessel rides along with the surface). */
  restPos: V3;
  restQ: Quat;
  restTimer: number;
  /** Parts that were touching the ground on the last step (to tell a first impact from resting contact). */
  touching: Set<string>;

  throttle: number;
  controls: Controls;
  sas: { enabled: boolean; mode: SasMode; hold: Quat | null };
  rcs: boolean;
  legsOut: boolean;
  brakes: boolean;
  nextStage: number;
  charge: number;
  chargeMax: number;
  /** Mission elapsed time (s) since the vessel left the pad. */
  met: number;
  /** Largest dynamic pressure seen (Pa), for the flight report. */
  maxQ: number;
  /** Delta-v the engines have delivered so far (m/s): the integral of thrust acceleration, for burn guidance. */
  dvSpent: number;
  /** Messages for the player; the scene drains this. */
  log: string[];
  tele: Telemetry;
  /** Topology caches. */
  children: Map<string, string[]>;
  order: string[];
  segment: Map<string, number>;
  exposedTop: Set<string>;
  exposedBottom: Set<string>;
}

export const emptyTelemetry = (): Telemetry => ({ q: 0, mach: 0, aoa: 0, gForce: 0, thrust: 0, engines: 0, density: 0, pressure: 0, clearance: 0, stress: 0, airflow: [0, 1, 0], heat: 0, heatFlux: 0 });

export const noControls = (): Controls => ({ pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0 });

let nextVesselId = 1;

const fromInstance = (p: PartInstance): FlightPart => {
  const def = partDef(p.def);
  return {
    id: p.id,
    def,
    pos: [p.pos[0], p.pos[1], p.pos[2]],
    yaw: p.yaw,
    flip: p.flip,
    link: { parent: p.parent, parentNode: p.parentNode, node: p.node },
    stage: p.stage,
    dry: def.dryMass,
    fuel: def.propellant ? def.propellant.mass * p.fill : 0,
    ignited: false,
    burn: 0,
    chute: 'stowed',
    chuteDeploy: 0,
    leg: 0,
    temperature: 288,
    ablator: def.category === 'heatshield' ? def.dryMass * 0.55 : 0,
  };
};

/** A vessel with these parts and nothing else set: the caller places it and gives it a state. */
export function newVessel(name: string, parts: FlightPart[], rootId: string): Vessel {
  const v: Vessel = {
    id: nextVesselId++,
    name,
    debris: false,
    parts,
    rootId,
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    q: QIDENTITY,
    w: [0, 0, 0],
    mass: { mass: 1, com: [0, 0, 0], inertia: [1, 0, 0, 0, 1, 0, 0, 0, 1], invInertia: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    situation: 'rest',
    restPos: [0, 0, 0],
    restQ: QIDENTITY,
    restTimer: 0,
    touching: new Set(),
    throttle: 0,
    controls: noControls(),
    sas: { enabled: false, mode: 'stability', hold: null },
    rcs: false,
    legsOut: false,
    brakes: false,
    nextStage: 0,
    charge: 0,
    chargeMax: 0,
    met: 0,
    maxQ: 0,
    dvSpent: 0,
    log: [],
    tele: emptyTelemetry(),
    children: new Map(),
    order: [],
    segment: new Map(),
    exposedTop: new Set(),
    exposedBottom: new Set(),
  };
  v.charge = v.chargeMax = v.parts.reduce((sum, p) => sum + (p.def.charge?.capacity ?? 0), 0);
  refresh(v);
  return v;
}

/** Make a flight vessel from a craft. Kinematics are placed by the caller. */
export function buildVessel(craft: Craft, name = craft.name): Vessel {
  const tree = buildTree(craft);
  return newVessel(name, craft.parts.map(fromInstance), tree?.root ?? craft.parts[0]?.id ?? '');
}

export const getFlightPart = (v: Vessel, id: string): FlightPart | undefined => v.parts.find((p) => p.id === id);

/** Direction (craft frame) a part's thrust pushes the craft, and where the exhaust leaves. */
export const thrustAxis = (p: FlightPart): V3 => rotate(p, [0, 1, 0]);
export function exhaustPoint(p: FlightPart): V3 {
  const r = rotate(p, [0, -p.def.height / 2, 0]);
  return [p.pos[0] + r[0], p.pos[1] + r[1], p.pos[2] + r[2]];
}

// ---------------------------------------------------------------- topology

/**
 * Rebuild everything derived from which parts are present: the tree rooted at the vessel's root, fuel segments (cut at
 * decouplers), which stack ends are exposed to the airflow, and the mass properties.
 */
export function refresh(v: Vessel): void {
  const ids = new Set(v.parts.map((p) => p.id));
  const adj = new Map<string, string[]>(v.parts.map((p) => [p.id, []]));
  for (const p of v.parts) {
    const par = p.link.parent;
    if (par && ids.has(par)) {
      adj.get(p.id)!.push(par);
      adj.get(par)!.push(p.id);
    }
  }
  if (!ids.has(v.rootId)) v.rootId = v.parts[0]?.id ?? '';
  v.children = new Map(v.parts.map((p) => [p.id, []]));
  v.order = [];
  v.segment = new Map();
  const seen = new Set<string>();
  let segments = 0;
  const queue: string[] = v.rootId ? [v.rootId] : [];
  if (v.rootId) {
    seen.add(v.rootId);
    v.segment.set(v.rootId, 0);
  }
  const byId = new Map(v.parts.map((p) => [p.id, p]));
  while (queue.length) {
    const cur = queue.shift()!;
    v.order.push(cur);
    for (const n of adj.get(cur) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      v.children.get(cur)!.push(n);
      v.segment.set(n, byId.get(n)!.def.decoupler ? ++segments : v.segment.get(cur)!);
      queue.push(n);
    }
  }
  // Exposure: an end with a node and something attached is covered; a part with no node there is open to the air.
  const covered = new Set<string>();
  for (const p of v.parts) {
    const par = p.link.parent;
    if (!par || !ids.has(par)) continue;
    if (p.link.parentNode && p.link.parentNode !== 'surface') covered.add(`${par}:${p.link.parentNode}`);
    if (p.link.node && p.link.node !== 'surface') covered.add(`${p.id}:${p.link.node}`);
  }
  v.exposedTop = new Set();
  v.exposedBottom = new Set();
  for (const p of v.parts) {
    if (p.def.surface) continue;
    // flipped parts swap their ends
    const [top, bottom] = p.flip ? ['bottom', 'top'] : ['top', 'bottom'];
    if (!covered.has(`${p.id}:${top}`)) v.exposedTop.add(p.id);
    if (!covered.has(`${p.id}:${bottom}`)) v.exposedBottom.add(p.id);
  }
  v.mass = computeMass(v);
}

/** Mass, centre of mass and inertia tensor (about the centre of mass, craft axes) from the parts, treated as solid cylinders. */
export function computeMass(v: Vessel): MassProps {
  let mass = 0;
  const c: V3 = [0, 0, 0];
  for (const p of v.parts) {
    const m = p.dry + p.fuel;
    mass += m;
    c[0] += m * p.pos[0];
    c[1] += m * p.pos[1];
    c[2] += m * p.pos[2];
  }
  if (mass <= 0) return { mass: 1, com: [0, 0, 0], inertia: [1, 0, 0, 0, 1, 0, 0, 0, 1], invInertia: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  const com: V3 = [c[0] / mass, c[1] / mass, c[2] / mass];
  const I: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of v.parts) {
    const m = p.dry + p.fuel;
    const r = p.def.surface ? Math.max(p.def.radius, 0.2) : p.def.radius;
    const h = p.def.height;
    const side = (m * (3 * r * r + h * h)) / 12;
    const axial = (m * r * r) / 2;
    const d = vsub(p.pos, com);
    const d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    // body axes: Y is the cylinder axis
    I[0] += side + m * (d2 - d[0] * d[0]);
    I[4] += axial + m * (d2 - d[1] * d[1]);
    I[8] += side + m * (d2 - d[2] * d[2]);
    I[1] -= m * d[0] * d[1];
    I[3] -= m * d[0] * d[1];
    I[2] -= m * d[0] * d[2];
    I[6] -= m * d[0] * d[2];
    I[5] -= m * d[1] * d[2];
    I[7] -= m * d[1] * d[2];
  }
  return { mass, com, inertia: I, invInertia: mat3Inverse(I) };
}

/** Cheap update for fuel burning: same structure, new masses. */
export function updateMass(v: Vessel): void {
  v.mass = computeMass(v);
}

// ---------------------------------------------------------------- splitting

/** Parts reachable from `id` without passing through `blocked`. */
function component(v: Vessel, start: string, alive: Set<string>): Set<string> {
  const adj = new Map<string, string[]>();
  for (const p of v.parts) if (alive.has(p.id)) adj.set(p.id, []);
  for (const p of v.parts) {
    const par = p.link.parent;
    if (alive.has(p.id) && par && alive.has(par)) {
      adj.get(p.id)!.push(par);
      adj.get(par)!.push(p.id);
    }
  }
  const out = new Set([start]);
  const stack = [start];
  while (stack.length) {
    for (const n of adj.get(stack.pop()!) ?? []) {
      if (!out.has(n)) {
        out.add(n);
        stack.push(n);
      }
    }
  }
  return out;
}

/**
 * Cut `ids` (a set of part ids) out of the vessel into a new vessel that keeps the current motion (every point keeps the
 * velocity it had). The original vessel keeps the rest. Positions and velocities of both centres of mass are updated.
 */
export function carve(v: Vessel, ids: Set<string>, debris = true): Vessel {
  const taken = v.parts.filter((p) => ids.has(p.id));
  const kept = v.parts.filter((p) => !ids.has(p.id));
  const out: Vessel = {
    ...v,
    id: nextVesselId++,
    name: `${v.name} debris`,
    debris,
    parts: taken,
    rootId: taken[0]?.id ?? '',
    controls: noControls(),
    sas: { enabled: false, mode: 'stability', hold: null },
    throttle: v.throttle,
    log: [],
    tele: emptyTelemetry(),
    legsOut: v.legsOut,
    nextStage: Number.MAX_SAFE_INTEGER,
    charge: 0,
    chargeMax: 0,
    children: new Map(),
    order: [],
    segment: new Map(),
    exposedTop: new Set(),
    exposedBottom: new Set(),
    w: [...v.w],
    vel: [...v.vel],
    pos: [...v.pos],
    q: [...v.q],
    restPos: [...v.restPos],
    restQ: [...v.restQ],
    touching: new Set(),
    mass: v.mass,
  };
  // The cut piece's root is the part closest to the old root.
  const depth = new Map(v.order.map((id, i) => [id, i]));
  out.rootId = taken.reduce((best, p) => ((depth.get(p.id) ?? 1e9) < (depth.get(best.id) ?? 1e9) ? p : best), taken[0]!).id;
  const oldCom = v.mass.com;
  const oldPos = v.pos;
  const oldVel = v.vel;
  v.parts = kept;
  // New centres of mass: compute masses first, then give each piece the velocity of its own centre of mass.
  refresh(v);
  refresh(out);
  for (const piece of [v, out]) {
    if (piece.parts.length === 0) continue;
    const local = piece.mass.com;
    const wWorld = qrot(piece.q, piece.w);
    const rel = qrot(piece.q, vsub(local, oldCom));
    piece.pos = [oldPos[0] + rel[0], oldPos[1] + rel[1], oldPos[2] + rel[2]];
    piece.vel = [oldVel[0] + wWorld[1] * rel[2] - wWorld[2] * rel[1], oldVel[1] + wWorld[2] * rel[0] - wWorld[0] * rel[2], oldVel[2] + wWorld[0] * rel[1] - wWorld[1] * rel[0]];
  }
  return out;
}

/** Split `v` into connected pieces after parts were removed. The piece holding a command part (else the largest) stays `v`. */
export function splitDisconnected(v: Vessel): Vessel[] {
  const alive = new Set(v.parts.map((p) => p.id));
  const pieces: Array<Set<string>> = [];
  const left = new Set(alive);
  while (left.size) {
    const first = left.values().next().value as string;
    const comp = component(v, first, alive);
    pieces.push(comp);
    for (const id of comp) left.delete(id);
  }
  if (pieces.length <= 1) return [];
  const mass = (s: Set<string>) => v.parts.filter((p) => s.has(p.id)).reduce((m, p) => m + p.dry + p.fuel, 0);
  const hasCommand = (s: Set<string>) => v.parts.some((p) => s.has(p.id) && p.def.category === 'command');
  const keep = pieces.find(hasCommand) ?? pieces.reduce((a, b) => (mass(b) > mass(a) ? b : a));
  const made: Vessel[] = [];
  for (const piece of pieces) {
    if (piece === keep) continue;
    made.push(carve(v, piece));
  }
  return made;
}

export const hasCommand = (v: Vessel): boolean => v.parts.some((p) => p.def.category === 'command');
export const totalMass = (v: Vessel): number => v.mass.mass;


/**
 * What a saved flight contains and how it is turned into a running one: every vessel with every part's state, the body whose
 * frame the world is in and the universal time, the maneuver nodes and target, and the craft as it left the Hangar (so
 * "restart on the pad" still works after loading). Plain JSON, versioned through the save record's schema number.
 * Pure: no rendering and no storage.
 */
import { parseCraft, serializeCraft, type Craft } from '../builder/craft';
import { partDef } from '../builder/part-library';
import { bodyFlightEnv, type BodyHost } from '../flight/body-env';
import { FlightWorld } from '../flight/flight-world';
import type { ManeuverNode } from '../flight/maneuver';
import type { Quat, V3 } from '../flight/math3';
import { newVessel, type ChuteState, type FlightPart, type SasMode, type Situation, type Vessel } from '../flight/vessel';
import { hasPart } from '../builder/part-library';

export interface PartSave {
  id: string;
  def: string;
  pos: V3;
  yaw: number;
  flip: boolean;
  link: { parent: string | null; parentNode: string | null; node: string | null };
  stage: number;
  dry: number;
  fuel: number;
  ignited: boolean;
  chute: ChuteState;
  chuteDeploy: number;
  leg: number;
  temperature: number;
  ablator: number;
}

export interface VesselSave {
  name: string;
  debris: boolean;
  parts: PartSave[];
  rootId: string;
  pos: V3;
  vel: V3;
  q: Quat;
  w: V3;
  situation: Situation;
  restPos: V3;
  restQ: Quat;
  restTimer: number;
  throttle: number;
  sas: { enabled: boolean; mode: SasMode; hold: Quat | null };
  rcs: boolean;
  legsOut: boolean;
  brakes: boolean;
  nextStage: number;
  charge: number;
  met: number;
  maxQ: number;
  dvSpent: number;
}

export interface FlightSaveData {
  kind: 'flight';
  /** Body whose frame the vessels are in, and universal time (s since J2000). */
  body: string;
  ut: number;
  vessels: VesselSave[];
  /** Index of the active vessel in `vessels`, or -1. */
  active: number;
  nodes: ManeuverNode[];
  target: string | null;
  /** The launched craft as JSON (null if unknown). */
  craft: string | null;
  initialFuel: number;
  camera: 'orbit' | 'pad' | 'nose';
}

const SITUATIONS: Situation[] = ['rest', 'flying', 'destroyed'];
const SAS_MODES: SasMode[] = ['stability', 'prograde', 'retrograde', 'normal', 'antinormal', 'radialIn', 'radialOut', 'maneuver'];

export function captureVessel(v: Vessel): VesselSave {
  return {
    name: v.name,
    debris: v.debris,
    parts: v.parts.map((p) => ({
      id: p.id,
      def: p.def.id,
      pos: [...p.pos],
      yaw: p.yaw,
      flip: p.flip,
      link: { ...p.link },
      stage: p.stage,
      dry: p.dry,
      fuel: p.fuel,
      ignited: p.ignited,
      chute: p.chute,
      chuteDeploy: p.chuteDeploy,
      leg: p.leg,
      temperature: p.temperature,
      ablator: p.ablator,
    })),
    rootId: v.rootId,
    pos: [...v.pos],
    vel: [...v.vel],
    q: [...v.q],
    w: [...v.w],
    situation: v.situation,
    restPos: [...v.restPos],
    restQ: [...v.restQ],
    restTimer: v.restTimer,
    throttle: v.throttle,
    sas: { enabled: v.sas.enabled, mode: v.sas.mode, hold: v.sas.hold ? [...v.sas.hold] : null },
    rcs: v.rcs,
    legsOut: v.legsOut,
    brakes: v.brakes,
    nextStage: v.nextStage,
    charge: v.charge,
    met: v.met,
    maxQ: v.maxQ,
    dvSpent: v.dvSpent,
  };
}

const finite = (a: unknown, n: number): a is number[] => Array.isArray(a) && a.length === n && a.every((x) => typeof x === 'number' && Number.isFinite(x));

export function restoreVessel(d: VesselSave): Vessel {
  if (!Array.isArray(d.parts) || d.parts.length === 0) throw new Error('A saved vessel has no parts.');
  const parts: FlightPart[] = d.parts.map((p) => {
    if (!hasPart(p.def)) throw new Error(`This save uses a part that no longer exists (${p.def}).`);
    if (!finite(p.pos, 3)) throw new Error('A saved part has a broken position.');
    return {
      id: p.id,
      def: partDef(p.def),
      pos: [p.pos[0], p.pos[1], p.pos[2]],
      yaw: p.yaw,
      flip: p.flip,
      link: { parent: p.link.parent, parentNode: p.link.parentNode, node: p.link.node },
      stage: p.stage,
      dry: p.dry,
      fuel: p.fuel,
      ignited: p.ignited,
      burn: 0,
      chute: p.chute,
      chuteDeploy: p.chuteDeploy,
      leg: p.leg,
      temperature: p.temperature,
      ablator: p.ablator,
    };
  });
  if (!finite(d.pos, 3) || !finite(d.vel, 3) || !finite(d.q, 4) || !finite(d.w, 3) || !finite(d.restPos, 3) || !finite(d.restQ, 4)) throw new Error('A saved vessel has a broken state.');
  if (!SITUATIONS.includes(d.situation)) throw new Error('A saved vessel has an unknown situation.');
  const v = newVessel(d.name, parts, d.rootId);
  v.debris = d.debris;
  v.pos = [d.pos[0], d.pos[1], d.pos[2]];
  v.vel = [d.vel[0], d.vel[1], d.vel[2]];
  v.q = [d.q[0], d.q[1], d.q[2], d.q[3]];
  v.w = [d.w[0], d.w[1], d.w[2]];
  v.situation = d.situation;
  v.restPos = [d.restPos[0], d.restPos[1], d.restPos[2]];
  v.restQ = [d.restQ[0], d.restQ[1], d.restQ[2], d.restQ[3]];
  v.restTimer = d.restTimer;
  v.throttle = d.throttle;
  v.sas = { enabled: d.sas.enabled, mode: SAS_MODES.includes(d.sas.mode) ? d.sas.mode : 'stability', hold: finite(d.sas.hold, 4) ? [d.sas.hold[0], d.sas.hold[1], d.sas.hold[2], d.sas.hold[3]] : null };
  v.rcs = d.rcs;
  v.legsOut = d.legsOut;
  v.brakes = d.brakes;
  v.nextStage = d.nextStage;
  v.charge = d.charge;
  v.met = d.met;
  v.maxQ = d.maxQ;
  v.dvSpent = d.dvSpent;
  return v;
}

export interface FlightExtras {
  nodes: ManeuverNode[];
  target: string | null;
  craft: Craft | null;
  initialFuel: number;
  camera: 'orbit' | 'pad' | 'nose';
}

export function captureFlight(world: FlightWorld, extras: FlightExtras): FlightSaveData {
  return {
    kind: 'flight',
    body: world.bodyId,
    ut: world.ut,
    vessels: world.vessels.map(captureVessel),
    active: world.active ? world.vessels.indexOf(world.active) : -1,
    nodes: extras.nodes.map((n) => ({ ...n })),
    target: extras.target,
    craft: extras.craft ? serializeCraft(extras.craft) : null,
    initialFuel: extras.initialFuel,
    camera: extras.camera,
  };
}

/** A world in the saved body's frame at the saved time, ready to receive the vessels. */
export function worldFor(data: FlightSaveData, host: BodyHost): FlightWorld {
  return new FlightWorld(bodyFlightEnv(host, data.body), data.ut, host);
}

/** Put the saved vessels into `world` (made with `worldFor`). Throws a readable error for a broken or incompatible save. */
export function restoreFlight(data: FlightSaveData, world: FlightWorld): FlightExtras {
  if (!data || data.kind !== 'flight' || !Array.isArray(data.vessels)) throw new Error('This save does not contain a flight.');
  world.vessels = data.vessels.map(restoreVessel);
  world.active = data.active >= 0 ? (world.vessels[data.active] ?? null) : null;
  world.env.update?.(world.ut);
  world.version++;
  return {
    nodes: (data.nodes ?? []).filter((n) => Number.isFinite(n.ut)),
    target: data.target ?? null,
    craft: data.craft ? parseCraft(data.craft) : null,
    initialFuel: data.initialFuel > 0 ? data.initialFuel : 1,
    camera: data.camera ?? 'orbit',
  };
}

/**
 * Live craft statistics: mass, centre of mass and pressure, and a stage-by-stage burn simulation that gives delta-v and
 * thrust-to-weight. The simulation follows the staging order: each stage fires its decouplers and ignites its engines, then
 * keeps burning every active engine (this stage's and any carried over) until the next stage can usefully fire: that is, until
 * everything its decouplers would drop has run dry. Pure maths: no rendering imports.
 */
import { buildTree, getPart, type Craft, type PartInstance, type V3 } from './craft';
import { partDef } from './part-library';
import { segments, stageParts } from './staging';
import type { EngineSpec, PartDef } from './part-types';

/** Standard gravity (m/s^2), used to convert specific impulse to exhaust velocity and for Earth weight. */
export const G0 = 9.80665;

export interface StageStats {
  index: number;
  engines: number;
  /** Thrust of every engine burning at the start of this stage (N). */
  thrustSL: number;
  thrustVac: number;
  /** Effective specific impulse of those engines (s). */
  ispSL: number;
  ispVac: number;
  /** Mass at ignition (after separation) and when the stage ends (kg). */
  massStart: number;
  massEnd: number;
  dvSL: number;
  dvVac: number;
  /** Thrust-to-weight at ignition, against `gravity`. */
  twrSL: number;
  twrVac: number;
  burnTime: number;
}

/** One stage of a burn simulation at a single ambient pressure. */
interface StageSim {
  index: number;
  engines: number;
  thrustSL: number;
  thrustVac: number;
  ispSL: number;
  ispVac: number;
  massStart: number;
  massEnd: number;
  /** Delta-v of the stage at the simulated pressure (m/s) and how long it burns (s). */
  dv: number;
  burnTime: number;
}

export interface CraftStats {
  partCount: number;
  wetMass: number;
  dryMass: number;
  com: V3 | null;
  cop: V3 | null;
  /** Height of the centre of mass above the centre of pressure (m): positive is aerodynamically stable. */
  stabilityMargin: number | null;
  stages: StageStats[];
  dvSL: number;
  dvVac: number;
  /** Thrust-to-weight of the first stage at launch. */
  twrSL: number;
  twrVac: number;
}

/** Thrust (N) and Isp (s) of an engine at ambient pressure `p` (0 = vacuum, 1 = sea level). */
export function engineAt(e: EngineSpec, p: number): { thrust: number; isp: number } {
  return { thrust: e.thrustVac + (e.thrustSL - e.thrustVac) * p, isp: e.ispVac + (e.ispSL - e.ispVac) * p };
}

const propellantOf = (p: PartInstance, d: PartDef): number => (d.propellant ? d.propellant.mass * p.fill : 0);

interface Engine {
  id: string;
  spec: EngineSpec;
  pool: string;
}

/** Run the staged burn at pressure `p`. */
export function simulateStages(c: Craft, p: number): StageSim[] {
  const tree = buildTree(c);
  if (!tree) return [];
  const seg = segments(c, tree);
  const groups = stageParts(c);
  const alive = new Set(c.parts.map((x) => x.id));
  const fuel = new Map<string, number>();
  const dry = new Map<string, number>();
  for (const part of c.parts) {
    const d = partDef(part.def);
    dry.set(part.id, d.dryMass);
    if (d.propellant) fuel.set(part.id, propellantOf(part, d));
  }
  const poolKey = (partId: string, kind: string) => `${seg.of.get(partId) ?? -1}|${kind}`;
  const totalMass = (): number => {
    let m = 0;
    for (const id of alive) m += dry.get(id)! + (fuel.get(id) ?? 0);
    return m;
  };
  /** Propellant remaining per pool, counting only parts still attached. */
  const poolMass = (key: string): number => {
    let m = 0;
    for (const [id, f] of fuel) if (alive.has(id) && poolKey(id, partDef(getPart(c, id)!.def).propellant!.kind) === key) m += f;
    return m;
  };
  const drain = (key: string, amount: number): void => {
    const tanks = [...fuel.keys()].filter((id) => alive.has(id) && poolKey(id, partDef(getPart(c, id)!.def).propellant!.kind) === key);
    const total = tanks.reduce((s, id) => s + fuel.get(id)!, 0);
    if (total <= 0) return;
    for (const id of tanks) fuel.set(id, fuel.get(id)! - amount * (fuel.get(id)! / total));
  };

  const ignited = new Map<string, Engine>();
  const results: StageSim[] = [];
  const EPS = 1e-6;

  const activeEngines = (): Engine[] => [...ignited.values()].filter((e) => alive.has(e.id) && poolMass(e.pool) > EPS);
  /** Would the next stage's decouplers usefully drop something whose engines are all spent? */
  const nextStageReady = (k: number): boolean => {
    const next = groups[k + 1];
    if (!next) return false;
    const decouplers = next.filter((x) => partDef(x.def).decoupler);
    if (decouplers.length === 0) return false;
    let dropsSpent = false;
    for (const dec of decouplers) {
      for (const id of subtreeInTree(tree, dec.id)) {
        const eng = ignited.get(id);
        if (eng) {
          if (poolMass(eng.pool) > EPS) return false;
          dropsSpent = true;
        }
      }
    }
    return dropsSpent;
  };

  for (let k = 0; k < groups.length; k++) {
    const members = groups[k]!;
    for (const m of members) {
      if (partDef(m.def).decoupler && alive.has(m.id)) for (const id of subtreeInTree(tree, m.id)) alive.delete(id);
    }
    const own: Engine[] = [];
    for (const m of members) {
      const d = partDef(m.def);
      if (d.engine && alive.has(m.id)) {
        const eng: Engine = { id: m.id, spec: d.engine, pool: poolKey(m.id, d.engine.propellant) };
        ignited.set(m.id, eng);
        own.push(eng);
      }
    }

    const stats: StageSim = { index: k, engines: own.length, thrustSL: 0, thrustVac: 0, ispSL: 0, ispVac: 0, massStart: totalMass(), massEnd: 0, dv: 0, burnTime: 0 };
    let first = true;
    for (let guard = 0; guard < 64; guard++) {
      const active = activeEngines();
      // Burn while anything is firing, until the next stage can usefully fire (its decouplers drop only spent engines).
      if (active.length === 0 || nextStageReady(k)) break;
      const flows = new Map<string, number>();
      let thrust = 0;
      let flow = 0;
      for (const e of active) {
        const { thrust: f, isp } = engineAt(e.spec, p);
        const mdot = f / (isp * G0);
        thrust += f;
        flow += mdot;
        flows.set(e.pool, (flows.get(e.pool) ?? 0) + mdot);
      }
      if (first) {
        const sl = active.reduce((a, e) => ({ f: a.f + engineAt(e.spec, 1).thrust, w: a.w + engineAt(e.spec, 1).thrust / engineAt(e.spec, 1).isp }), { f: 0, w: 0 });
        const vac = active.reduce((a, e) => ({ f: a.f + engineAt(e.spec, 0).thrust, w: a.w + engineAt(e.spec, 0).thrust / engineAt(e.spec, 0).isp }), { f: 0, w: 0 });
        stats.thrustSL = sl.f;
        stats.thrustVac = vac.f;
        stats.ispSL = sl.f / sl.w;
        stats.ispVac = vac.f / vac.w;
        first = false;
      }
      let t = Infinity;
      for (const [key, rate] of flows) t = Math.min(t, poolMass(key) / rate);
      const m0 = totalMass();
      const dm = flow * t;
      const ve = thrust / flow; // effective exhaust velocity (m/s)
      stats.dv += ve * Math.log(m0 / (m0 - dm));
      stats.burnTime += t;
      for (const [key, rate] of flows) drain(key, rate * t);
    }
    stats.massEnd = totalMass();
    results.push(stats);
  }
  return results;
}

function subtreeInTree(tree: { children: Map<string, string[]> }, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    for (const ch of tree.children.get(cur) ?? []) stack.push(ch);
  }
  return out;
}

/** Everything the stats panel shows. */
export function computeStats(c: Craft, gravity = G0): CraftStats {
  let wet = 0;
  let dry = 0;
  const com: V3 = [0, 0, 0];
  let wx = 0;
  const cop: V3 = [0, 0, 0];
  for (const p of c.parts) {
    const d = partDef(p.def);
    const m = d.dryMass + propellantOf(p, d);
    wet += m;
    dry += d.dryMass;
    for (let i = 0; i < 3; i++) {
      com[i]! += m * p.pos[i]!;
      cop[i]! += d.cpWeight * p.pos[i]!;
    }
    wx += d.cpWeight;
  }
  const hasParts = c.parts.length > 0;
  const comPos: V3 | null = hasParts && wet > 0 ? [com[0]! / wet, com[1]! / wet, com[2]! / wet] : null;
  const copPos: V3 | null = hasParts && wx > 0 ? [cop[0]! / wx, cop[1]! / wx, cop[2]! / wx] : null;

  const vac = simulateStages(c, 0);
  const sl = simulateStages(c, 1);
  const stages: StageStats[] = vac.map((v, i) => ({
    index: v.index,
    engines: v.engines,
    thrustSL: v.thrustSL,
    thrustVac: v.thrustVac,
    ispSL: v.ispSL,
    ispVac: v.ispVac,
    massStart: v.massStart,
    massEnd: v.massEnd,
    dvVac: v.dv,
    dvSL: sl[i]?.dv ?? 0,
    twrSL: v.massStart > 0 ? v.thrustSL / (v.massStart * gravity) : 0,
    twrVac: v.massStart > 0 ? v.thrustVac / (v.massStart * gravity) : 0,
    burnTime: v.burnTime,
  }));
  const first = stages.find((s) => s.engines > 0);
  return {
    partCount: c.parts.length,
    wetMass: wet,
    dryMass: dry,
    com: comPos,
    cop: copPos,
    stabilityMargin: comPos && copPos ? comPos[1] - copPos[1] : null,
    stages,
    dvSL: stages.reduce((s, x) => s + x.dvSL, 0),
    dvVac: stages.reduce((s, x) => s + x.dvVac, 0),
    twrSL: first?.twrSL ?? 0,
    twrVac: first?.twrVac ?? 0,
  };
}

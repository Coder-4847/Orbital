/**
 * Things that happen to a vessel besides moving: staging, breakage, parachute and landing-leg state, electric power. Each takes
 * callbacks for the new vessels and visual events it produces, so the physics stays free of any rendering.
 */
import { vadd, vlen, vnorm, vscale, vsub, qrot, type V3 } from './math3';
import { sunlit, type FlightEnv } from './env';
import { carve, getFlightPart, refresh, splitDisconnected, type FlightPart, type Vessel } from './vessel';

export interface FlightEvent {
  kind: 'explosion' | 'separation' | 'chute' | 'touchdown' | 'liftoff' | 'ignition' | 'soi';
  /** Inertial position (relative to the body's centre). */
  pos: V3;
  size: number;
  text?: string;
}

export interface OpsContext {
  spawn(v: Vessel): void;
  event(e: FlightEvent): void;
}

/** Part and everything beyond it (away from the vessel's root). */
export function subtree(v: Vessel, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    out.add(cur);
    for (const c of v.children.get(cur) ?? []) stack.push(c);
  }
  return out;
}

const partWorld = (v: Vessel, p: FlightPart): V3 => vadd(v.pos, qrot(v.q, vsub(p.pos, v.mass.com)));

/** Relative speed given to a separated stage (m/s). */
const SEPARATION_SPEED = 1.2;

/**
 * Fire the next stage of the vessel: decouplers release what hangs beyond them, engines ignite, parachutes arm. Returns the
 * stage number fired, or -1 if there was nothing left to fire.
 */
export function activateStage(v: Vessel, ctx: OpsContext): number {
  let stage = v.nextStage;
  const last = Math.max(-1, ...v.parts.map((p) => p.stage));
  while (stage <= last && !v.parts.some((p) => p.stage === stage)) stage++;
  if (stage > last) {
    v.nextStage = stage;
    return -1;
  }
  const group = v.parts.filter((p) => p.stage === stage);
  // Decouplers first, so engines that go with the released stage are not lit by this one.
  for (const dec of group.filter((p) => p.def.decoupler)) {
    if (!getFlightPart(v, dec.id)) continue; // already gone with an earlier piece
    const ids = subtree(v, dec.id);
    if (ids.has(v.rootId)) continue;
    const axis = qrot(v.q, vnorm(vsub(dec.pos, v.mass.com)));
    const debris = carve(v, ids);
    debris.throttle = 0;
    debris.nextStage = Number.MAX_SAFE_INTEGER;
    const mKept = v.mass.mass;
    const mOut = debris.mass.mass;
    const dir = vnorm(vsub(debris.pos, v.pos));
    const push = vlen(dir) > 0 ? dir : axis;
    const dvOut = (SEPARATION_SPEED * mKept) / (mKept + mOut);
    const dvKept = (SEPARATION_SPEED * mOut) / (mKept + mOut);
    debris.vel = vadd(debris.vel, vscale(push, dvOut));
    v.vel = vsub(v.vel, vscale(push, dvKept));
    ctx.spawn(debris);
    ctx.event({ kind: 'separation', pos: partWorld(debris, debris.parts[0]!), size: dec.def.radius * 2 });
  }
  for (const p of v.parts.filter((x) => x.stage === stage)) {
    if (p.def.engine && !p.ignited) {
      p.ignited = true;
      ctx.event({ kind: 'ignition', pos: partWorld(v, p), size: p.def.radius * 2 });
    }
    if (p.def.category === 'parachute' && p.chute === 'stowed') p.chute = 'armed';
  }
  v.nextStage = stage + 1;
  v.log.push(`Stage ${stage} activated.`);
  return stage;
}

/** Arm every parachute (the manual button). */
export function armChutes(v: Vessel): void {
  for (const p of v.parts) if (p.def.category === 'parachute' && p.chute === 'stowed') p.chute = 'armed';
}

/** Remove destroyed parts (they explode); what they carried breaks away as debris. */
export function destroyParts(v: Vessel, ids: string[], ctx: OpsContext, why: string): void {
  const doomed = new Set(ids);
  for (const id of doomed) {
    const p = getFlightPart(v, id);
    if (p) ctx.event({ kind: 'explosion', pos: partWorld(v, p), size: Math.max(2, p.def.radius * 3 + p.def.height * 0.5), text: why });
  }
  v.parts = v.parts.filter((p) => !doomed.has(p.id));
  if (v.parts.length === 0) {
    v.situation = 'destroyed';
    return;
  }
  if (doomed.has(v.rootId)) v.rootId = '';
  refresh(v);
  for (const piece of splitDisconnected(v)) ctx.spawn(piece);
  v.touching = new Set([...v.touching].filter((id) => !doomed.has(id)));
}

/** A joint failed: everything beyond it drifts off as debris. */
export function failJoint(v: Vessel, partId: string, ctx: OpsContext): void {
  const ids = subtree(v, partId);
  if (ids.has(v.rootId) || ids.size === v.parts.length) return;
  const piece = carve(v, ids);
  piece.throttle = 0;
  piece.nextStage = Number.MAX_SAFE_INTEGER;
  ctx.spawn(piece);
  const part = piece.parts[0];
  if (part) ctx.event({ kind: 'separation', pos: partWorld(piece, part), size: part.def.radius * 2, text: 'Structural failure' });
  v.log.push('Structural failure: part broke away.');
}

const DEPLOY_TIME: Record<string, number> = { 'chute-drogue': 1.5, 'chute-main': 4, 'chute-radial': 2.5 };
/** Dynamic pressure (Pa) above which opening tears the canopy: a drogue is built for much faster air than a main. */
const chuteMaxQ = (id: string): number => (id === 'chute-drogue' ? 45_000 : 14_000);
const MAIN_CHUTE_CEILING = 2500; // m above the ground: main chutes wait for this

/** Advance parachute states: armed ones open when the air is thick enough (and, for mains, low enough). */
export function updateChutes(v: Vessel, density: number, speed: number, heightAboveGround: number, dt: number): void {
  const q = 0.5 * density * speed * speed;
  for (const p of v.parts) {
    if (p.def.category !== 'parachute') continue;
    const low = p.def.id === 'chute-drogue' || heightAboveGround < MAIN_CHUTE_CEILING;
    if (p.chute === 'armed' && density > 0.03 && low) {
      p.chute = 'deploying';
      p.chuteDeploy = 0;
      v.log.push(`${p.def.name} deploying.`);
    }
    if (p.chute === 'deploying' || p.chute === 'deployed') {
      if (q > chuteMaxQ(p.def.id) * (p.chute === 'deploying' ? 1 : 1.6)) {
        p.chute = 'cut';
        p.chuteDeploy = 0;
        v.log.push(`${p.def.name} torn away: too fast.`);
        continue;
      }
      if (p.chute === 'deploying') {
        p.chuteDeploy = Math.min(1, p.chuteDeploy + dt / (DEPLOY_TIME[p.def.id] ?? 3));
        if (p.chuteDeploy >= 1) p.chute = 'deployed';
      }
    }
  }
}

const LEG_SPEED = 0.4; // fraction per second

export function updateLegs(v: Vessel, dt: number): void {
  const target = v.legsOut ? 1 : 0;
  for (const p of v.parts) {
    if (p.def.look !== 'leg') continue;
    p.leg += Math.sign(target - p.leg) * Math.min(Math.abs(target - p.leg), LEG_SPEED * dt);
  }
}

/** Solar panels charge the batteries while lit; reaction wheels draw power while turning. */
export function updatePower(v: Vessel, env: FlightEnv, dt: number, steering: boolean): void {
  if (v.chargeMax <= 0) {
    v.chargeMax = v.parts.reduce((s, p) => s + (p.def.charge?.capacity ?? 0), 0);
    v.charge = Math.min(v.charge, v.chargeMax);
  }
  const lit = sunlit(env, v.pos);
  let delta = 0;
  for (const p of v.parts) {
    const c = p.def.charge;
    if (!c) continue;
    if (c.generation && lit) delta += c.generation * dt;
    if (c.use && steering) delta -= c.use * dt;
  }
  v.charge = Math.min(v.chargeMax, Math.max(0, v.charge + delta));
}


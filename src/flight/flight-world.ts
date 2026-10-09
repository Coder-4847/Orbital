/**
 * The flight world: every vessel near the player, stepped together. One step integrates a vessel's rigid-body motion under
 * gravity, thrust, aerodynamics, control torques and ground contact, then handles staging side effects, breakage and landing.
 * A vessel resting on the ground rides along with the rotating surface until something lifts it. Pure maths: the scene reads
 * the vessels and the event queue and draws them.
 */
import { bodyDef } from '../data/solar-system';
import { buildVessel, getFlightPart, updateMass, type Vessel } from './vessel';
import type { Craft } from '../builder/craft';
import { aeroForces } from './aero';
import { contactForces } from './contact';
import { fromBodyFixed, surfaceVelocity, toBodyFixed, type FlightEnv } from './env';
import { bodyFlightEnv, type BodyHost } from './body-env';
import { heatVessel } from './heating';
import { activateStage, armChutes, destroyParts, failJoint, updateChutes, updateLegs, updatePower, type FlightEvent, type OpsContext } from './flight-ops';
import { clamp, mat3Vec, qconj, qfromBasis, qfromTo, qintegrate, qmul, qrot, qrotInv, vadd, vcross, vdot, vlen, vmad, vnorm, vscale, vsub, type V3 } from './math3';
import { controlAuthority, propulsion, pressureRatio, poolMasses } from './propulsion';
import { flightVectors, sasCommand, sasTarget } from './sas';
import { propagate } from '../physics/kepler';
import { jointLoads } from './structure';
import { G0 } from '../builder/stats';

const REST_SPEED = 0.15; // m/s relative to the ground
const REST_SPIN = 0.04; // rad/s
const REST_TIME = 1.2; // s of stillness before a landed vessel is frozen to the ground
const RCS_ISP = 240;

/** Sandbox switches (the cheats menu). All off by default; the scene copies the player's choices here. */
export interface CheatFlags {
  unlimitedFuel: boolean;
  unlimitedCharge: boolean;
  /** Engine thrust is multiplied by this (1 = normal). */
  thrustMultiplier: number;
  invulnerable: boolean;
  noHeating: boolean;
  noAero: boolean;
  zeroGravity: boolean;
  /** Time warp on rails is allowed anywhere. */
  maxWarp: boolean;
}

export const NO_CHEATS: CheatFlags = { unlimitedFuel: false, unlimitedCharge: false, thrustMultiplier: 1, invulnerable: false, noHeating: false, noAero: false, zeroGravity: false, maxWarp: false };

export interface PadSite {
  /** Direction from the body's centre to the pad in the body-fixed frame (unit), and compass heading of body +X (degrees). */
  direction: V3;
  headingDeg: number;
}

const SOI_CHECK_INTERVAL = 0.25; // s of simulated time between sphere-of-influence checks

export class FlightWorld {
  vessels: Vessel[] = [];
  active: Vessel | null = null;
  ut = 0;
  /** The body whose frame the vessels are expressed in (position and velocity relative to its centre, inertial axes). */
  bodyId: string;
  readonly events: FlightEvent[] = [];
  /** Direction (unit, inertial) of the maneuver burn still to fly: what SAS 'maneuver' points at. Set by the scene. */
  maneuverDir: V3 | null = null;
  cheats: CheatFlags = { ...NO_CHEATS };
  /** Counts physics steps: anything cached from a vessel's state is stale when this changes. */
  version = 0;
  private soiTimer = 0;
  private readonly envs = new Map<string, FlightEnv>();
  private readonly ctx: OpsContext = { spawn: (v) => this.vessels.push(v), event: (e) => this.events.push(e) };

  /** `host` poses the bodies and lets the world hand vessels over between spheres of influence; without it the world is one body. */
  constructor(public env: FlightEnv, ut = 0, readonly host: BodyHost | null = null) {
    this.ut = ut;
    this.bodyId = env.id ?? 'earth';
    this.envs.set(this.bodyId, env);
    env.update?.(ut);
  }

  /** The environment of a body (created on first use). */
  envOf(id: string): FlightEnv {
    let e = this.envs.get(id);
    if (!e) {
      e = bodyFlightEnv(this.host!, id);
      this.envs.set(id, e);
    }
    return e;
  }

  /**
   * Re-express every vessel in the frame of body `id`: the vessels keep their heliocentric state, only the origin and the
   * environment change. Vessels resting on the old body stay behind (they are dropped from the world).
   */
  switchBody(id: string): void {
    if (!this.host || id === this.bodyId) return;
    const eph = this.host.ephemeris;
    const from = eph.stateAt(this.bodyId, this.ut);
    const to = eph.stateAt(id, this.ut);
    const dp = vsub(from.pos, to.pos);
    const dv = vsub(from.vel, to.vel);
    this.vessels = this.vessels.filter((v) => v.situation !== 'rest');
    for (const v of this.vessels) {
      v.pos = vadd(v.pos, dp);
      v.vel = vadd(v.vel, dv);
      v.touching.clear();
    }
    const old = this.bodyId;
    this.bodyId = id;
    this.env = this.envOf(id);
    this.env.update?.(this.ut);
    if (this.active && !this.vessels.includes(this.active)) this.active = null;
    this.events.push({ kind: 'soi', pos: this.active?.pos ?? [0, 0, 0], size: 0, text: `${bodyDef(id).name}|${bodyDef(old).name}` });
    this.version++;
  }

  /** Move to the body whose sphere of influence holds the active vessel, if that is not the current one. */
  checkSoi(): void {
    const v = this.active;
    if (!this.host || !v || v.situation === 'rest') return;
    const c = this.host.ephemeris.get(this.bodyId).pos;
    const id = this.host.ephemeris.dominantBody([c[0] + v.pos[0], c[1] + v.pos[1], c[2] + v.pos[2]]);
    if (id !== this.bodyId) this.switchBody(id);
  }

  /**
   * Place a craft in free flight at `pos`/`vel` relative to the current body (inertial axes), nose along `forward`, and make it
   * the active vessel. For starting in orbit (tests, quick-start) and for staging experiments.
   */
  spawn(craft: Craft, pos: V3, vel: V3, forward: V3): Vessel {
    const v = buildVessel(craft);
    v.pos = pos;
    v.vel = vel;
    const y = vnorm(forward);
    const hint: V3 = Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const x = vnorm(vcross(hint, y));
    v.q = qfromBasis(x, y, vcross(x, y));
    v.situation = 'flying';
    this.vessels.push(v);
    this.active = v;
    return v;
  }

  /** Put a craft at rest on the ground at `site`, nose up, and make it the active vessel. */
  launch(craft: Craft, site: PadSite): Vessel {
    const v = buildVessel(craft);
    this.vessels.push(v);
    this.active = v;
    this.setOnSurface(v, site);
    return v;
  }

  /** Stand a vessel on the ground at `site` (nose up, +X along the heading) in the current body's frame, at rest. */
  setOnSurface(v: Vessel, site: PadSite): void {
    const dir = vnorm(site.direction);
    const ground = this.env.groundRadius(fromBodyFixed(this.env, dir));
    const minY = Math.min(...v.parts.map((p) => p.pos[1] - p.def.height / 2));
    v.restPos = vscale(dir, ground + (v.mass.com[1] - minY) + 0.02);
    // body +Y up; +X along the heading, measured in the body-fixed frame
    const spin = toBodyFixed(this.env, this.env.spinAxis);
    let east = vcross(spin, dir);
    if (vlen(east) < 1e-9) east = [1, 0, 0];
    east = vnorm(east);
    const north = vnorm(vcross(dir, east));
    const h = (site.headingDeg * Math.PI) / 180;
    const x = vadd(vscale(north, Math.cos(h)), vscale(east, Math.sin(h)));
    v.restQ = qfromBasis(x, dir, vcross(x, dir));
    v.situation = 'rest';
    v.restTimer = 0;
    v.touching.clear();
    v.throttle = 0;
    v.w = [0, 0, 0];
    this.placeAtRest(v);
    this.version++;
  }

  /** Set position, attitude and velocity of a resting vessel from the planet's current pose. */
  private placeAtRest(v: Vessel): void {
    v.pos = fromBodyFixed(this.env, v.restPos);
    v.q = qmul(this.env.planetQuat, v.restQ);
    v.vel = surfaceVelocity(this.env, v.pos);
    v.w = qrotInv(v.q, vscale(this.env.spinAxis, this.env.spinRate));
  }

  stage(v = this.active): number {
    if (!v || v.situation === 'destroyed') return -1;
    const n = activateStage(v, this.ctx);
    if (n < 0) v.log.push('No more stages.');
    return n;
  }

  deployChutes(v = this.active): void {
    if (v) armChutes(v);
  }

  step(dt: number): void {
    this.ut += dt;
    this.version++;
    this.env.update?.(this.ut);
    for (const v of [...this.vessels]) {
      if (v.situation === 'destroyed') continue;
      this.stepVessel(v, dt);
    }
    this.soiTimer += dt;
    if (this.soiTimer >= SOI_CHECK_INTERVAL) {
      this.soiTimer = 0;
      this.checkSoi();
    }
    this.vessels = this.vessels.filter((v) => v.situation !== 'destroyed' && v.parts.length > 0 && !this.shouldCull(v));
    if (this.active && !this.vessels.includes(this.active)) this.active = this.vessels.find((v) => v.parts.some((p) => p.def.category === 'command')) ?? null;
  }

  /**
   * Time warp on rails: move the active vessel along its Kepler orbit by `dt` without simulating it. Everything in flight is
   * dropped except landed vessels (which ride the ground), the way a vessel in a coast is treated. The cached trajectory stays
   * valid, so `version` does not change. The caller makes sure the orbit stays clear of air and ground (see Navigator).
   */
  railsMove(dt: number): void {
    const v = this.active;
    this.ut += dt;
    this.env.update?.(this.ut);
    this.vessels = this.vessels.filter((x) => x === v || x.situation === 'rest');
    for (const x of this.vessels) if (x.situation === 'rest') this.placeAtRest(x);
    if (!v || v.situation !== 'flying') return;
    const s = propagate({ r: v.pos, v: v.vel }, this.env.mu, dt);
    v.pos = s.r;
    v.vel = s.v;
    v.met += dt;
    v.w = [0, 0, 0];
    v.touching.clear();
    if (v.sas.enabled && v.sas.mode !== 'stability') {
      const fv = flightVectors(v, this.env);
      fv.maneuver = this.maneuverDir;
      const target = sasTarget(v.sas.mode, fv);
      if (target) v.q = qmul(qfromTo(qrot(v.q, [0, 1, 0]), target), v.q);
    }
  }

  /** Spent debris: lying still for a while, or far from the action. */
  private shouldCull(v: Vessel): boolean {
    if (!v.debris) return false;
    if (v.situation === 'rest' && v.restTimer > 30) return true;
    return !!this.active && vlen(vsub(v.pos, this.active.pos)) > 150_000;
  }

  private stepVessel(v: Vessel, dt: number): void {
    const env = this.env;
    if (v.situation === 'rest') this.placeAtRest(v);
    const r = vlen(v.pos);
    const altitude = r - env.radius;
    const g = env.mu / (r * r);
    const air = env.air ? env.air(altitude) : { pressure: 0, density: 0, temperature: 250 };
    const ratio = pressureRatio(air.pressure);

    // --- control: pilot input, with SAS filling in
    const fv = flightVectors(v, env);
    fv.maneuver = this.maneuverDir;
    const authority = controlAuthority(v, ratio, v.rcs);
    const pilot = v.controls;
    const piloting = Math.abs(pilot.pitch) + Math.abs(pilot.yaw) + Math.abs(pilot.roll) > 0.02;
    let cmd = { pitch: pilot.pitch, yaw: pilot.yaw, roll: pilot.roll };
    if (v.sas.enabled && v.situation !== 'rest') {
      // In stability mode the attitude to hold follows the pilot while they steer, so SAS only damps the axes they are not using.
      if (v.sas.mode === 'stability' && (piloting || !v.sas.hold)) v.sas.hold = [...v.q];
      const sas = sasCommand(v, fv, authority);
      const used = (x: number) => Math.abs(x) > 0.02;
      cmd = { pitch: used(pilot.pitch) ? pilot.pitch : sas.pitch, yaw: used(pilot.yaw) ? pilot.yaw : sas.yaw, roll: used(pilot.roll) ? pilot.roll : sas.roll };
    }
    cmd = { pitch: clamp(cmd.pitch, -1, 1), yaw: clamp(cmd.yaw, -1, 1), roll: clamp(cmd.roll, -1, 1) };

    // --- forces in the body frame
    const vAir = vsub(v.vel, surfaceVelocity(env, v.pos));
    const vAirBody = qrotInv(v.q, vAir);
    const speed = vlen(vAir);
    const cheats = this.cheats;
    const fuelBefore = cheats.unlimitedFuel ? v.parts.map((p) => p.fuel) : null;
    const aero = cheats.noAero ? { force: [0, 0, 0] as V3, torque: [0, 0, 0] as V3, perPart: new Map<string, V3>() } : aeroForces(v, vAirBody, v.w, air.density, air.temperature, cmd);
    const prop = propulsion(v, ratio, dt, cmd);
    if (cheats.thrustMultiplier !== 1) {
      const k = cheats.thrustMultiplier;
      prop.force = vscale(prop.force, k);
      prop.torque = vscale(prop.torque, k);
      prop.thrust *= k;
      for (const [id, f] of prop.perPart) prop.perPart.set(id, vscale(f, k));
    }
    this.heatAndCrush(v, vAirBody, speed, air, dt);
    if (v.situation === 'destroyed') return;
    const rcsForce = this.rcsForce(v, dt);
    if (fuelBefore) v.parts.forEach((p, i) => (p.fuel = fuelBefore[i] ?? p.fuel));
    updateChutes(v, air.density, speed, Math.max(0, altitude - this.groundAltitude(v)), dt);
    updateLegs(v, dt);

    let force: V3 = vadd(vadd(aero.force, prop.force), rcsForce);
    const wheels = this.wheelTorque(v, cmd);
    let torque: V3 = vadd(vadd(aero.torque, prop.torque), wheels);
    const mass = v.mass.mass;
    const forceWorld = qrot(v.q, force);

    // --- resting on the ground: hold still until the engines can lift the weight
    if (v.situation === 'rest') {
      const up = vnorm(v.pos);
      if (vdot(forceWorld, up) > mass * g * 1.001) {
        v.situation = 'flying';
        v.restTimer = 0;
        this.events.push({ kind: 'liftoff', pos: v.pos, size: 4, text: 'Liftoff' });
        v.log.push('Liftoff!');
      } else {
        v.restTimer += dt;
        this.finishStep(v, dt, air, speed, prop, force, g, 0);
        return;
      }
    }

    // --- ground contact
    const contact = contactForces(v, env, g, dt);
    const gravity = cheats.zeroGravity ? ([0, 0, 0] as V3) : vscale(v.pos, -env.mu / (r * r * r));
    const accel = vadd(vscale(vadd(forceWorld, contact.force), 1 / mass), gravity);
    torque = vadd(torque, qrotInv(v.q, contact.torque));

    // --- integrate
    const I = v.mass.inertia;
    const alpha = mat3Vec(v.mass.invInertia, vsub(torque, vcross(v.w, mat3Vec(I, v.w))));
    v.vel = vmad(v.vel, accel, dt);
    v.pos = vmad(v.pos, v.vel, dt);
    v.w = vmad(v.w, alpha, dt);
    v.q = qintegrate(v.q, v.w, dt);

    // --- structure: joints load up with thrust, air and the vessel's own acceleration
    const external = new Map(aero.perPart);
    for (const [id, f] of prop.perPart) external.set(id, vadd(external.get(id) ?? [0, 0, 0], f));
    for (const [id, f] of contact.perPart) external.set(id, vadd(external.get(id) ?? [0, 0, 0], qrotInv(v.q, f)));
    const ngAccel = vscale(vadd(force, qrotInv(v.q, contact.force)), 1 / mass);
    const loads = jointLoads(v, external, ngAccel, alpha, v.w);
    const worst = loads.reduce((m, l) => Math.max(m, l.ratio), 0);
    const failed = loads.filter((l) => l.ratio > 1).sort((a, b) => b.ratio - a.ratio)[0];
    if (failed && !cheats.invulnerable && getFlightPart(v, failed.partId)) failJoint(v, failed.partId, this.ctx);
    if (contact.broken.length > 0 && !cheats.invulnerable) {
      const ids = contact.broken.map((b) => b.id);
      v.log.push(`Crash: ${contact.broken.map((b) => getFlightPart(v, b.id)?.def.name ?? b.id).join(', ')} broke on impact at ${Math.round(contact.broken[0]!.speed)} m/s.`);
      destroyParts(v, ids, this.ctx, 'Impact');
    }
    this.settle(v, contact.count, dt, prop.thrust, mass * g);
    v.tele.clearance = contact.clearance;
    this.finishStep(v, dt, air, speed, prop, force, g, worst);
  }

  private finishStep(v: Vessel, dt: number, air: { pressure: number; density: number }, speed: number, prop: { thrust: number; firing: number }, force: V3, g: number, worst: number): void {
    if (v.situation !== 'rest') v.met += dt;
    updateMass(v); // fuel burned this step
    const q = 0.5 * air.density * speed * speed;
    v.maxQ = Math.max(v.maxQ, q);
    v.dvSpent += (prop.thrust / Math.max(v.mass.mass, 1)) * dt;
    const nose = qrot(v.q, [0, 1, 0]);
    const airDir = vnorm(vsub(v.vel, surfaceVelocity(this.env, v.pos)));
    updatePower(v, this.env, dt, Math.abs(v.controls.pitch) + Math.abs(v.controls.yaw) + Math.abs(v.controls.roll) > 0.02 || v.sas.enabled);
    if (this.cheats.unlimitedCharge) v.charge = v.chargeMax;
    v.tele = {
      ...v.tele,
      q,
      mach: speed / 330,
      aoa: speed > 1 ? Math.acos(clamp(vdot(nose, airDir), -1, 1)) : 0,
      gForce: vlen(force) / Math.max(v.mass.mass, 1) / G0 + (v.situation === 'rest' ? g / G0 : 0),
      thrust: prop.thrust,
      engines: prop.firing,
      density: air.density,
      pressure: air.pressure,
      stress: worst,
      airflow: speed > 0.5 ? qrotInv(v.q, vnorm(vsub(v.vel, surfaceVelocity(this.env, v.pos)))) : [0, 1, 0],
    };
  }

  /** Aerodynamic heating of every part, and the crushing pressure of deep atmospheres. */
  private heatAndCrush(v: Vessel, vAirBody: V3, speed: number, air: { pressure: number; density: number; temperature: number }, dt: number): void {
    if (this.cheats.noHeating) {
      v.tele.heat = 0;
      v.tele.heatFlux = 0;
    } else {
      const flow: V3 = speed > 0.5 ? vscale(vAirBody, 1 / speed) : [0, 1, 0];
      const res = heatVessel(v, flow, air.density, speed, air.temperature, dt);
      if (this.cheats.invulnerable) {
        for (const p of v.parts) p.temperature = Math.min(p.temperature, p.def.maxTemp * 0.95);
      } else if (res.overheated.length > 0) {
        v.log.push(`${res.overheated.length > 1 ? `${res.overheated.length} parts` : (getFlightPart(v, res.overheated[0]!)?.def.name ?? 'A part')} burned up: too hot.`);
        destroyParts(v, res.overheated, this.ctx, 'Overheated');
      }
    }
    const limit = this.env.crushPressure;
    if (limit && air.pressure > limit && v.parts.length > 0 && !this.cheats.invulnerable) {
      v.log.push(`Crushed by atmospheric pressure (${(air.pressure / 1e5).toFixed(0)} bar).`);
      destroyParts(v, v.parts.map((p) => p.id), this.ctx, 'Crushed');
    }
  }

  /** Cheat: fill every tank and battery, cool everything down, restore heat shields and re-pack spent parachutes. */
  refuelAndRepair(v: Vessel | null = this.active): void {
    if (!v) return;
    for (const p of v.parts) {
      if (p.def.propellant) p.fuel = p.def.propellant.mass;
      p.temperature = 288;
      if (p.def.category === 'heatshield') {
        p.dry += p.def.dryMass * 0.55 - p.ablator;
        p.ablator = p.def.dryMass * 0.55;
      }
      if (p.def.category === 'parachute' && p.chute === 'cut') p.chute = 'stowed';
    }
    v.charge = v.chargeMax;
    v.log.push('Refuelled and repaired.');
  }

  /** Landed and still for a while: freeze the vessel to the ground so it rides the rotation and costs nothing. */
  private settle(v: Vessel, contacts: number, dt: number, thrust: number, weight: number): void {
    const rel = vlen(vsub(v.vel, surfaceVelocity(this.env, v.pos)));
    if (contacts > 0 && rel < REST_SPEED && vlen(v.w) - vlen(qrotInv(v.q, vscale(this.env.spinAxis, this.env.spinRate))) < REST_SPIN && thrust < weight * 0.5) {
      v.restTimer += dt;
      if (v.restTimer > REST_TIME) {
        v.situation = 'rest';
        v.restPos = toBodyFixed(this.env, v.pos);
        v.restQ = qmul(qconj(this.env.planetQuat), v.q);
        if (v.debris) v.log.push('At rest.');
      }
    } else if (v.situation !== 'rest') {
      v.restTimer = 0;
    }
  }

  /** Height of the ground under the vessel above sea level (m). */
  private groundAltitude(v: Vessel): number {
    return this.env.groundRadius(v.pos) - this.env.radius;
  }

  private wheelTorque(v: Vessel, cmd: { pitch: number; yaw: number; roll: number }): V3 {
    if (v.chargeMax > 0 && v.charge <= 0) return [0, 0, 0];
    let wheels = 0;
    for (const p of v.parts) {
      if (p.def.torque) wheels += p.def.torque * 1000;
      if (v.rcs && p.def.rcsThrust) wheels += p.def.rcsThrust * Math.max(Math.hypot(p.pos[0] - v.mass.com[0], p.pos[2] - v.mass.com[2]), 0.3);
    }
    return [cmd.yaw * wheels, cmd.roll * wheels, -cmd.pitch * wheels];
  }

  /** RCS translation: thrust along body axes from the player's translation request, burning propellant. */
  private rcsForce(v: Vessel, dt: number): V3 {
    if (!v.rcs) return [0, 0, 0];
    const t = v.controls;
    if (Math.abs(t.tx) + Math.abs(t.ty) + Math.abs(t.tz) < 0.01) return [0, 0, 0];
    const thrust = v.parts.reduce((s, p) => s + (p.def.rcsThrust ?? 0), 0) * 2;
    if (thrust <= 0) return [0, 0, 0];
    const f: V3 = [t.tx * thrust, t.ty * thrust, t.tz * thrust];
    const mdot = (vlen(f) / (RCS_ISP * G0)) * dt;
    const pools = poolMasses(v);
    const tank = v.parts.find((p) => p.def.propellant?.kind === 'lfox' && p.fuel > 0);
    if (!tank || (pools.get(`${v.segment.get(tank.id) ?? -1}|lfox`) ?? 0) < mdot) return [0, 0, 0];
    tank.fuel -= mdot;
    return f;
  }
}

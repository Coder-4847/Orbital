/**
 * The flight guide: at every moment of a flight from the pad to orbit and back, the one thing to do next, in plain words.
 * Unlike the one-off hints (hints.ts) it is always on screen and follows the flight, so a new player is never left looking at
 * numbers without knowing what they are for. `guide` is the pure rule that picks the step from the state of the flight; text
 * may name actions as `{actionId}`, which the panel shows as the key bound to them.
 *
 * The ascent it teaches is one continuous burn: lean over by altitude through the air, then steer by vertical speed until the
 * periapsis is out of the atmosphere. `ascentPitch` is that recipe as a number; tests/guide.test.ts flies it with a clumsy pilot.
 */
import type { HintState } from './hints';

export type GuideStepId =
  | 'throttle' | 'ignite' | 'climb' | 'turn' | 'speed' | 'stage' | 'spent' | 'orbit'
  | 'deorbit' | 'reentry' | 'chutes' | 'descent' | 'landed' | 'away';

export interface GuideState extends HintState {
  /** Nose elevation above the horizon (degrees): 90 is straight up. */
  pitchDeg: number;
  /** Seconds to apoapsis (Infinity on an escape path). */
  timeToApoapsis: number;
  /** The vessel has been in a stable orbit at some point of this flight. */
  reachedOrbit: boolean;
  bodyName: string;
}

export const ASCENT_PHASES = ['Launch', 'Climb', 'Lean over', 'Gain speed', 'Orbit'] as const;
export const RETURN_PHASES = ['Deorbit', 'Re-entry', 'Parachutes', 'Landed'] as const;

export interface GuideView {
  id: GuideStepId;
  /** The row of phases this step belongs to and where it is in it; null away from Earth. */
  phases: readonly string[] | null;
  phase: number;
  title: string;
  text: string;
  /** A live figure for the step ("Periapsis 43 km of 85 km") and how far along it is, 0..1. */
  status?: string;
  progress?: number;
}

/** The periapsis the guide asks for before the engine is cut: this far above the top of the atmosphere. */
const PERIAPSIS_MARGIN = 5_000;
/** Below this altitude the nose follows the altitude table; above it the air no longer matters and vertical speed is the guide. */
export const STEER_BY_SPEED_ALTITUDE = 55_000;

/** Altitude (m) -> nose elevation (degrees) through the atmosphere: straight up for a kilometre, 60 at 10 km, 20 at 45 km. */
const PITCH_TABLE: ReadonlyArray<readonly [number, number]> = [[1000, 90], [2000, 80], [10_000, 60], [25_000, 40], [45_000, 20], [60_000, 10]];

/**
 * Where the nose should point during the climb (degrees above the horizon, in steps of 5), from altitude (m) and vertical
 * speed (m/s). Above the thick air the aim is to stop climbing and build sideways speed without starting to fall: nearly flat
 * while still rising fast, higher the closer the climb is to stalling.
 */
export function ascentPitch(altitude: number, verticalSpeed: number): number {
  if (altitude >= STEER_BY_SPEED_ALTITUDE) return verticalSpeed > 400 ? 5 : verticalSpeed > 150 ? 10 : verticalSpeed > 0 ? 20 : 30;
  if (altitude <= PITCH_TABLE[0]![0]) return 90;
  for (let i = 1; i < PITCH_TABLE.length; i++) {
    const [a1, p1] = PITCH_TABLE[i]!;
    if (altitude <= a1) {
      const [a0, p0] = PITCH_TABLE[i - 1]!;
      return Math.round((p0 + ((p1 - p0) * (altitude - a0)) / (a1 - a0)) / 5) * 5;
    }
  }
  return 10;
}

const km = (m: number): string => `${Math.round(m / 1000)} km`;

/** The step that fits this moment. `fmt` formats a length in the player's units. */
export function guide(s: GuideState, fmt: (metres: number) => string = km): GuideView {
  const ascent = (id: GuideStepId, phase: number, title: string, text: string, status?: string, progress?: number): GuideView => ({ id, phases: ASCENT_PHASES, phase, title, text, status, progress });
  const home = (id: GuideStepId, phase: number, title: string, text: string, status?: string, progress?: number): GuideView => ({ id, phases: RETURN_PHASES, phase, title, text, status, progress });

  if (s.bodyId !== 'earth') {
    const landed = s.situation === 'rest';
    return {
      id: 'away',
      phases: null,
      phase: 0,
      title: landed ? `On ${s.bodyName}` : `Near ${s.bodyName}`,
      text: landed
        ? 'You are down in one piece. Quick save with {quicksave}. To leave, throttle up and stage as you did on Earth: with less gravity and no air it takes far less fuel.'
        : `Your orbit is now measured around ${s.bodyName}. Open the map with {map} to see your path. To stay here, burn retrograde (SAS Ret) at the lowest point of the path until it closes into an orbit.`,
    };
  }

  const top = s.atmosphereTop;
  const peTarget = top + PERIAPSIS_MARGIN;

  if (s.situation === 'rest') {
    if (s.everLiftedOff) return home('landed', 3, 'Back on the ground', 'That is a complete flight. Press {pause} to restart on the pad, or go back to the Hangar and build something bigger.');
    if (s.throttle < 0.5) return ascent('throttle', 0, 'Throttle up', 'Press {throttleFull} for full throttle. Nothing happens yet: the engine only lights when you stage. The bar left of the navball shows the throttle.');
    return ascent('ignite', 0, 'Lift off', 'Press {stage} to light the first stage. Every press of {stage} fires the next line of the Staging list at the bottom left.');
  }

  // A few kilometres clear of the air before saying so: a player who cuts the engine the moment the card changes is still safe.
  const stable = s.periapsis > top + PERIAPSIS_MARGIN - 2000 && s.apoapsis > s.periapsis && Number.isFinite(s.apoapsis);
  if (stable) {
    const cut = s.throttle > 0 && s.thrust > 0 ? 'Cut the engine now with {throttleCut}: you are in orbit. ' : 'Engines off, and you keep falling around the Earth without ever coming down. ';
    return ascent(
      'orbit', 4, 'You are in orbit',
      `${cut}Open the map with {map} to see your path, and speed time up with {warpUp}. To come home: wait until To apoapsis is nearly zero, set SAS to Ret, and burn until Periapsis drops below ${fmt(top * 0.5)}.`,
      `Orbit ${fmt(s.periapsis)} × ${fmt(s.apoapsis)}`, 1,
    );
  }

  if (s.hasChutes && !s.chutesArmed && s.agl < 12_000 && s.speed < 500 && s.verticalSpeed < -20) {
    return home('chutes', 2, 'Open the parachutes', 'You are low and slow enough. Press {chutes} to arm the parachutes: they open by themselves when it is safe.', `${fmt(s.agl)} above the ground`);
  }
  if (s.chutesArmed && s.verticalSpeed < 0 && s.altitude < 15_000) {
    return home('descent', 2, 'Under the canopy', 'Nothing left to do but ride it down: the main canopy opens near the ground and the capsule takes the touchdown.', `Falling at ${Math.round(-s.verticalSpeed)} m/s, ${fmt(s.agl)} to go`);
  }
  if (s.reachedOrbit) {
    if (s.altitude > top) {
      return home(
        'deorbit', 0, 'Coming home',
        'Your path now dips into the air, which will slow you down for free. Cut the engine, press {stage} until only the capsule and its heat shield are left, and set SAS to Ret so the shield faces forward. Then speed time up with {warpUp} until you reach the atmosphere.',
        `Periapsis ${s.periapsis < 0 ? 'below the ground' : fmt(s.periapsis)} · the air begins at ${fmt(top)}`,
      );
    }
    return home('reentry', 1, 'Re-entry', 'Keep the heat shield pointing forward (SAS Ret) and let the air do the braking. Hull heat, under More on the right, shows how hot it is getting. Parachutes come next, once you are below 500 m/s.', `${fmt(s.altitude)} up at ${Math.round(s.speed)} m/s`);
  }

  if (s.throttle > 0 && s.thrust === 0 && s.met > 2) {
    if (s.stageWaiting) return ascent('stage', s.altitude < 1000 ? 1 : s.altitude < STEER_BY_SPEED_ALTITUDE ? 2 : 3, 'Stage', 'This stage has burned out. Press {stage} to drop it and light the next one.');
    return ascent('spent', 3, 'Out of fuel', 'The tanks are empty before reaching orbit, so this flight comes back down: arm the parachutes with {chutes} once you are low. Orbit needs about 9,400 m/s of delta-v, and the Hangar shows it for your design. Press {pause} to try again.', `Apoapsis ${fmt(Math.max(0, s.apoapsis))}`);
  }

  const idle = s.throttle === 0 ? 'The engine is off: press {throttleFull}. ' : '';
  if (s.altitude < 1000) {
    return ascent('climb', 1, 'Climb straight up', `${idle}Hands off for the first kilometre: SAS keeps the nose up while you gain speed.`, `${fmt(s.altitude)} up at ${Math.round(s.speed)} m/s`, Math.min(1, s.altitude / 1000));
  }

  const want = ascentPitch(s.altitude, s.verticalSpeed);
  const have = Math.round(s.pitchDeg);
  const off = have - want;
  const aim = `Attitude on the right reads ${have}°: `;
  const steer = off > 6 ? `${aim}tap {pitchUp} to bring the nose down to about ${want}°.` : off < -6 ? `${aim}tap {pitchDown} to bring the nose up to about ${want}°.` : `${aim}good, about ${want}° is right. Hands off until the number changes.`;
  if (s.altitude < STEER_BY_SPEED_ALTITUDE) {
    return ascent(
      'turn', 2, 'Lean over to the east',
      `${idle}${steer} Short taps, then let go: SAS holds wherever you leave it. Orbit is about going sideways fast, so the nose comes down as you climb: 60° at 10 km, 40° at 25 km, 20° at 45 km.`,
      `${fmt(s.altitude)} up · aim for ${want}°`, Math.min(1, s.altitude / STEER_BY_SPEED_ALTITUDE),
    );
  }
  const why = s.verticalSpeed <= 0 ? 'You are falling: nose up until Vertical speed is positive again.' : s.verticalSpeed > 150 ? 'You are still climbing fast, so nearly all the thrust can go sideways.' : 'Vertical speed is low: keep the nose a little above the horizon so you do not start to fall.';
  return ascent(
    'speed', 3, 'Gain speed for orbit',
    `${idle}${steer} ${why} Keep burning until Periapsis is above ${fmt(peTarget)}, then cut the engine with {throttleCut}.`,
    s.periapsis < 0 ? 'Periapsis is still below the ground' : `Periapsis ${fmt(s.periapsis)} of ${fmt(peTarget)}`, Math.min(1, Math.max(0, s.speed / 7600)),
  );
}

/** Hints the guide already covers: they are not shown while the guide is on screen. */
export const GUIDE_COVERS: readonly string[] = ['pad', 'steer', 'stage', 'orbit', 'chutes', 'map'];

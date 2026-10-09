/**
 * First-time guidance for flight. Each hint is shown once, when the situation it is about comes up, never twice and never while
 * another is showing. `nextHint` is the pure rule that picks which hint (if any) fits the moment; the scene shows it.
 */
export type HintId =
  | 'hangar' | 'pad' | 'steer' | 'stage' | 'orbit' | 'map' | 'node' | 'warp' | 'burn' | 'soi' | 'reentry' | 'chutes' | 'legs' | 'landed' | 'save';

export interface HintText {
  title: string;
  text: string;
}

export const HINTS: Record<HintId, HintText> = {
  hangar: { title: 'The Hangar', text: 'Pick a part on the left, then click the rocket to attach it. Stack tanks and engines, add a decoupler between stages, and watch the delta-v and thrust-to-weight on the right. Press Launch when it looks right. Not sure where to start? Open an example from the toolbar.' },
  pad: { title: 'On the pad', text: 'Press Z for full throttle, then Space to light the engines. If the rocket is too heavy for its engines it will sit and burn: check the thrust-to-weight ratio in the Hangar.' },
  steer: { title: 'Gravity turn', text: 'Tip the nose over to the east a little at a time with W, then switch SAS to Pro (prograde) and let the rocket follow its path. Keep the throttle down through the thickest air.' },
  stage: { title: 'Empty stage', text: 'The engines have run dry. Press Space to drop the spent stage and light the next one.' },
  orbit: { title: 'Nearly there', text: 'Coast up to your apoapsis, then burn prograde to raise the periapsis above the atmosphere (about 80 km on Earth). The map (M) shows both.' },
  map: { title: 'In orbit', text: 'Press M for the map. Click your orbit to place a maneuver node, set its delta-v in the panel, and the dotted path shows where the burn would take you.' },
  node: { title: 'Maneuver nodes', text: 'Set the prograde, normal and radial delta-v with the buttons or by typing; the path updates as you go. Focus a moon and press Target to mark your closest approach to it.' },
  warp: { title: 'Time warp', text: 'The ► button (or the period key) speeds time up. Above the atmosphere it can go to 100,000x; it stops by itself near the ground and refuses while an engine is running.' },
  burn: { title: 'Time to burn', text: 'Switch SAS to Mnv so the ship points along the burn, start about half the burn time before the node, and cut the engine when the remaining delta-v reaches zero.' },
  soi: { title: 'New sphere of influence', text: 'You have crossed into another body\'s gravity. Your orbit is now measured around it, and the map draws a new patch of your path.' },
  reentry: { title: 'Re-entry', text: 'The heat is building. Point the heat shield forward (SAS Ret keeps you backwards to your velocity) and ride it out. Anything unprotected will burn.' },
  chutes: { title: 'Parachutes', text: 'You are low and slow enough: press P to arm the parachutes. The drogue opens first, the main chute near the ground.' },
  legs: { title: 'Landing legs', text: 'Press G to put the landing legs down before you touch the ground, and null your sideways speed so you do not tip over.' },
  landed: { title: 'Landed', text: 'Nice. You can save this moment with F5 (quick save) or from the pause menu, and take off again when you are ready.' },
  save: { title: 'Saving', text: 'Press F5 to quick save and F9 to quick load. The game also saves itself every couple of minutes and when you leave.' },
};

export interface HintState {
  /** Hints turned off in Settings. */
  enabled: boolean;
  seen: ReadonlySet<string>;
  /** Something is on screen already. */
  busy: boolean;
  bodyId: string;
  situation: 'rest' | 'flying';
  /** Seconds since the vessel left the pad; 0 while on it. */
  met: number;
  /** Altitude above sea level and above the ground (m), speed relative to the surface (m/s), vertical speed (m/s). */
  altitude: number;
  agl: number;
  speed: number;
  verticalSpeed: number;
  apoapsis: number;
  periapsis: number;
  /** Top of the atmosphere (m), 0 if the body has none. */
  atmosphereTop: number;
  throttle: number;
  thrust: number;
  /** An unstaged stage is waiting. */
  stageWaiting: boolean;
  hullHeat: number;
  hasChutes: boolean;
  chutesArmed: boolean;
  hasLegs: boolean;
  legsOut: boolean;
  mapOpen: boolean;
  hasNode: boolean;
  /** A node is within 90 s of its burn. */
  nodeSoon: boolean;
  /** The vessel changed sphere of influence since the last check. */
  enteredSoi: boolean;
  /** Time warp is currently real time. */
  atRealTime: boolean;
  everLiftedOff: boolean;
}

/** The hint that fits this moment, or null. Order matters: the first matching rule wins. */
export function nextHint(s: HintState): HintId | null {
  if (!s.enabled || s.busy) return null;
  const fresh = (id: HintId) => !s.seen.has(id);
  const inSpace = s.altitude > s.atmosphereTop + 1000 && s.atmosphereTop > 0;
  const stable = s.periapsis > Math.max(s.atmosphereTop, 20_000) && s.apoapsis > s.periapsis && Number.isFinite(s.apoapsis);

  if (s.situation === 'rest' && s.met === 0 && !s.everLiftedOff && s.bodyId === 'earth' && fresh('pad')) return 'pad';
  if (s.enteredSoi && fresh('soi')) return 'soi';
  if (s.hullHeat > 0.35 && fresh('reentry')) return 'reentry';
  if (s.hasNode && s.nodeSoon && fresh('burn')) return 'burn';
  if (s.situation === 'flying' && s.atmosphereTop > 0 && s.altitude > 600 && s.altitude < s.atmosphereTop && s.speed > 80 && s.verticalSpeed > 20 && s.met < 240 && fresh('steer')) return 'steer';
  if (s.situation === 'flying' && s.throttle > 0 && s.thrust === 0 && s.stageWaiting && s.met > 5 && fresh('stage')) return 'stage';
  if (s.situation === 'flying' && s.atmosphereTop > 0 && s.altitude > s.atmosphereTop * 0.85 && s.periapsis < s.atmosphereTop && s.apoapsis > s.atmosphereTop * 1.2 && fresh('orbit')) return 'orbit';
  if (s.hasChutes && !s.chutesArmed && s.atmosphereTop > 0 && s.agl < 12_000 && s.speed < 500 && s.verticalSpeed < -20 && s.situation === 'flying' && fresh('chutes')) return 'chutes';
  if (s.hasLegs && !s.legsOut && s.agl < 2500 && s.verticalSpeed < -2 && s.situation === 'flying' && s.atmosphereTop === 0 && fresh('legs')) return 'legs';
  if (s.situation === 'rest' && s.everLiftedOff && s.bodyId !== 'earth' && fresh('landed')) return 'landed';
  if (stable && inSpace && !s.mapOpen && fresh('map')) return 'map';
  if (s.mapOpen && fresh('node')) return 'node';
  if (stable && inSpace && s.atRealTime && s.mapOpen === false && s.seen.has('map') && fresh('warp')) return 'warp';
  if (stable && inSpace && s.seen.has('map') && fresh('save')) return 'save';
  return null;
}

/**
 * How to Play: what the game is, a first flight to orbit step by step, what every part of the screen means, the map, the way
 * home and the words the game uses. Opened from the main menu, the pause menu and the flight guide. Key names come from the
 * player's own bindings.
 */
import type { AppContext } from '../../core/scene-manager';
import { button, tabs } from '../kit/controls';
import { h, type Child } from '../kit/dom';
import { openModal, type ModalHandle } from '../kit/modal';
import { withKeys } from '../flight/guide-panel';

export type HelpTab = 'start' | 'orbit' | 'screen' | 'map' | 'home' | 'words';

export function openHowToPlay(ctx: AppContext, initial: HelpTab = 'start'): ModalHandle {
  const bindings = ctx.settings.get().controls.bindings;
  const k = (text: string): Array<Node | string> => withKeys(text, bindings);
  const p = (text: string): HTMLElement => h('p', { class: 'help-p' }, ...k(text));
  const title = (text: string): HTMLElement => h('h3', { class: 'help-h', text });
  const steps = (...items: Array<[string, string]>): HTMLElement =>
    h('ol', { class: 'help-steps' }, ...items.map(([head, body]) => h('li', null, h('strong', { text: head }), h('span', null, ...k(body)))));
  const terms = (...items: Array<[string, string]>): HTMLElement =>
    h('dl', { class: 'help-terms' }, ...items.flatMap(([term, body]): Child[] => [h('dt', { text: term }), h('dd', null, ...k(body))]));
  const page = (...children: Child[]): HTMLElement => h('div', { class: 'help-page' }, ...children);

  const start = page(
    title('What you do here'),
    p('Orbital is a spaceflight sandbox with real physics and a real-size Earth. There are no missions and no score: you build a rocket, fly it, and see how far you can get. Orbit first, then the Moon, then anywhere in the solar system.'),
    terms(
      ['Hangar', 'Build a rocket from parts, or open a ready-made example from the toolbar. Launch sends it to the pad.'],
      ['Launch', 'Fly the rocket you built. If you have not built one you get Pathfinder, a forgiving trainer that can reach orbit and come back.'],
      ['Explorer', 'A free camera to look around the planets. Nothing to fly, nothing to break.'],
    ),
    title('If you only read one thing'),
    p('In flight, the Flight guide card at the top left always says what to do next and which key does it. Follow it from the pad and it will take you to orbit and back. Press {pause} at any time to pause, save, restart or read this again.'),
    title('The five keys that matter'),
    terms(
      ['{throttleFull} / {throttleCut}', 'Full throttle / engine off. {throttleUp} and {throttleDown} adjust it gradually.'],
      ['{stage}', 'Stage: light the engine, and later drop empty stages and light the next.'],
      ['{pitchUp} {pitchDown} {yawLeft} {yawRight}', 'Steer. {rollLeft} and {rollRight} roll.'],
      ['{map}', 'The map: your path around the planet.'],
      ['{warpUp} / {warpDown}', 'Speed time up / slow it down. {warpReset} returns to real time.'],
    ),
  );

  const orbit = page(
    title('Your first flight to orbit'),
    p('Going to space is going up 100 km. Staying there is the hard part: you have to go sideways at about 7.8 km/s, so fast that as you fall you keep missing the ground. So a launch is mostly a long push to the east.'),
    steps(
      ['Throttle up.', 'Press {throttleFull}. Nothing moves yet.'],
      ['Lift off.', 'Press {stage}. The first stage lights.'],
      ['Climb straight up', 'for the first kilometre. SAS holds the nose steady for you.'],
      ['Lean over to the east.', 'Tap {pitchUp} a little at a time and watch Attitude on the right: about 60° at 10 km, 40° at 25 km, 20° at 45 km. Short taps, then let go.'],
      ['Stage when the engine dies.', 'Press {stage} to drop the empty stage and light the next. Keep burning.'],
      ['Above 55 km, hold your height.', 'The aim now is speed sideways, not height: the guide shows an angle that is near the horizon while you are still climbing and rises if you start to sink. Altitude should stay near 100 km. Watch Periapsis climb.'],
      ['Cut the engine', 'with {throttleCut} when Periapsis is above 85 km. You are in orbit.'],
    ),
    p('The Flight guide does this arithmetic for you: it shows the angle to aim for at every moment. If the rocket flips over, you turned too hard while low and fast: use shorter taps. The starter rocket, Pathfinder, has several tonnes of fuel to spare; a rocket of your own needs about 9,400 m/s of delta-v. Watch Propellant: if it is nearly gone and Periapsis is still far below the target, restart from the pause menu and lean over earlier.'),
  );

  const screen = page(
    title('Reading the screen'),
    terms(
      ['Flight guide (top left)', 'The next thing to do. The row of names is the whole flight; the bright one is where you are.'],
      ['Staging (bottom left)', 'What each press of {stage} will fire, from the top of the list down. The buttons under it switch SAS, RCS thrusters, landing legs, brakes and parachutes.'],
      ['Navball (bottom centre)', 'Which way the rocket points. Blue is sky, brown is ground, the line between is the horizon. The orange mark in the centre is your nose: in the middle of the blue means straight up, on the white horizon line means flat. The green circle is the direction you are actually moving (prograde). The red line is north; east is a quarter turn to its right.'],
      ['Speed (above the navball)', 'SRF is speed over the ground, used low down. ORB is orbital speed, used in space.'],
      ['Throttle (left of the navball)', 'How hard the engines are pushing, 0 to 100%.'],
      ['SAS buttons (under the navball)', 'The autopilot for pointing. Hold keeps the nose where it is, Pro points along your path, Ret against it. Mnv points along a planned burn.'],
      ['Readouts (bottom right)', 'Altitude, speed up or down, where the nose points (Attitude), and the two numbers that describe an orbit: Apoapsis (highest point) and Periapsis (lowest point). More shows everything else. Hover over any label for what it means.'],
      ['Top bar', 'Menu, the Guide switch, camera ({camera}), time warp, and the Map ({map}).'],
    ),
  );

  const map = page(
    title('The map and planning burns'),
    p('Press {map} once you are in orbit. The line is the path you will follow if you never touch the engine again. Drag to turn the view, scroll to zoom.'),
    steps(
      ['Place a maneuver node:', 'click a point on your orbit. A node is a planned engine burn at that spot.'],
      ['Shape the burn', 'in the panel: prograde makes the far side of the orbit higher, retrograde lower. The dotted line shows the path the burn would give you.'],
      ['Fly it.', 'Back in flight, set SAS to Mnv. Start the burn about half its length before the node and stop when the remaining delta-v reads zero.'],
    ),
    title('Going to the Moon'),
    p('From a low orbit, plan a prograde burn of about 3,100 m/s and slide the node around the orbit until the dotted path reaches the Moon. Focus the Moon and press Target to see your closest approach. Once there, burn retrograde at the lowest point to stay.'),
  );

  const home = page(
    title('Coming home'),
    steps(
      ['Lower your orbit.', 'Wait until you are near apoapsis (To apoapsis close to zero), set SAS to Ret and burn until Periapsis is below about 40 km. The air will do the rest.'],
      ['Drop everything but the capsule.', 'Press {stage} until only the capsule and heat shield are left.'],
      ['Shield first.', 'Keep SAS on Ret so the heat shield faces the way you are moving. Watch Hull heat.'],
      ['Parachutes.', 'Below about 12 km and 500 m/s, press {chutes}. They open on their own when it is safe.'],
    ),
    title('Saving'),
    p('{quicksave} quick saves and {quickload} loads it back. The game also saves by itself every couple of minutes. The pause menu ({pause}) has named saves and Restart on the pad.'),
  );

  const words = page(
    title('Words the game uses'),
    terms(
      ['Apoapsis / Periapsis', 'The highest and lowest points of your path around a body. Both above the atmosphere means a stable orbit.'],
      ['Prograde / Retrograde', 'The direction you are moving, and the opposite. Burning prograde speeds you up and raises the other side of the orbit; retrograde lowers it.'],
      ['Delta-v', 'How much a rocket can change its speed with the fuel it has, in m/s. It is the range of a rocket: low Earth orbit costs about 9,400, the Moon and back about 6,000 more.'],
      ['Thrust-to-weight (TWR)', 'Engine push divided by weight. Below 1 the rocket cannot leave the pad; 1.3 to 2 is comfortable at lift-off.'],
      ['Stage', 'A section of the rocket that is dropped when its fuel is gone, so the rest does not have to carry empty tanks.'],
      ['SAS', 'Stability assist: holds or points the rocket for you.'],
      ['RCS', 'Small thrusters for turning and nudging in space. Not needed for a first flight.'],
      ['Gravity turn', 'Leaning over gradually during the climb so gravity itself bends your path towards the horizon.'],
      ['Sphere of influence', 'The region where one body\'s gravity dominates. Cross into the Moon\'s and your orbit is measured around the Moon.'],
      ['Time warp', 'Running time faster. Coasting to the Moon takes three days of real time without it.'],
    ),
  );

  const content = tabs(
    [
      { id: 'start', label: 'Start here', content: start },
      { id: 'orbit', label: 'First orbit', content: orbit },
      { id: 'screen', label: 'The screen', content: screen },
      { id: 'map', label: 'Map and burns', content: map },
      { id: 'home', label: 'Coming home', content: home },
      { id: 'words', label: 'Glossary', content: words },
    ],
    initial,
  );
  const modal = openModal({
    title: 'How to play',
    size: 'lg',
    content,
    footer: button({ label: 'Close', variant: 'primary', onClick: () => modal.close() }),
  });
  return modal;
}

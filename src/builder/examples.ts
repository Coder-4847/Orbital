/** Example crafts, built with the same rules the Hangar uses (see compose.ts). */
import { above, below, belowVia, finish, onDecoupler, radial, startCraft } from './compose';
import { getPart, type Craft } from './craft';
import { partDef } from './part-library';

export interface ExampleCraft {
  id: string;
  title: string;
  blurb: string;
  /** Not meant to leave the pad: it starts in orbit (pause-menu cheat) or sits on top of another launcher. */
  orbitOnly?: boolean;
  build(): Craft;
}

const yOf = (c: Craft, id: string): number => getPart(c, id)!.pos[1];

/** A two-stage rocket that reaches low Earth orbit: a 2.5 m first stage under a 1.25 m upper stage and capsule. */
function sparrow(): Craft {
  const { craft, root } = startCraft('Sparrow-1 orbital rocket', 'pod-capsule');
  above(craft, root, 'chute-main');
  const upperTank = below(craft, root, 'tank-125-4');
  const upperEngine = below(craft, upperTank, 'eng-vacuum-110');
  const dec = below(craft, upperEngine, 'dec-125');
  const widen = below(craft, dec, 'adapter-125-250');
  const t1 = below(craft, widen, 'tank-250-4');
  const t2 = below(craft, t1, 'tank-250-4');
  const narrow = belowVia(craft, t2, 'adapter-125-250', 'bottom'); // wide end up, 1.25 m end down for the engine
  belowVia(craft, narrow, 'eng-sea-850', 'top', 'top');
  radial(craft, t2, 'fin-large', 4, yOf(craft, t2) - 1.2);
  return finish(craft);
}

/**
 * The part of the Moon mission that goes to the Moon and back: capsule with heat shield, a service module with the ascent
 * engine, a descent stage with legs, and a transfer stage. Returns the id of its lowest part (the transfer engine).
 */
function moonModule(name: string): { craft: Craft; bottom: string } {
  const { craft, root } = startCraft(name, 'pod-capsule');
  above(craft, above(craft, root, 'chute-main'), 'chute-drogue'); // drogue on top: it slows the fall so the main canopy opens safely
  const shield = below(craft, root, 'shield-125');
  const dropService = below(craft, shield, 'dec-125'); // the capsule leaves the service module before re-entry
  const ascentTank = below(craft, dropService, 'tank-125-2');
  getPart(craft, ascentTank)!.fill = 0.7; // the ascent stage needs about 3 km/s, not the 4 the tank would give
  const ascentEngine = below(craft, ascentTank, 'eng-vacuum-110');
  const decDescent = below(craft, ascentEngine, 'dec-125');
  const descentTank = below(craft, decDescent, 'tank-125-4');
  const descentEngine = below(craft, descentTank, 'eng-spark');
  radial(craft, descentTank, 'leg-large', 4, yOf(craft, descentTank) - 2);
  const decTransfer = below(craft, descentEngine, 'dec-125');
  const widen = below(craft, decTransfer, 'adapter-125-250');
  const transferTank = below(craft, widen, 'tank-250-4');
  const transferTank2 = below(craft, transferTank, 'tank-250-2');
  const bottom = below(craft, transferTank2, 'eng-vac-600');
  return { craft, bottom };
}

/** The Moon module alone, for starting in orbit (the pause menu's cheat) or for building your own launcher under it. */
function seleneModule(): Craft {
  return finish(moonModule('Selene Moon module').craft);
}

/** A complete Moon mission: a two-stage launcher under the Selene Moon module. About 950 t on the pad. */
function selene(): Craft {
  const { craft, bottom } = moonModule('Selene Moon mission');
  const decUpper = below(craft, bottom, 'dec-250');
  const upper1 = below(craft, decUpper, 'tank-250-8');
  const upper2 = below(craft, upper1, 'tank-250-8');
  const upper3 = below(craft, upper2, 'tank-250-8');
  const upper4 = below(craft, upper3, 'tank-250-8');
  const upperEngine = below(craft, upper4, 'eng-vac-1500');
  const decLaunch = below(craft, upperEngine, 'dec-250');
  const widen2 = below(craft, decLaunch, 'adapter-250-375');
  const core1 = below(craft, widen2, 'tank-375-16');
  const core2 = below(craft, core1, 'tank-375-16');
  const core3 = below(craft, core2, 'tank-375-16');
  const core4 = below(craft, core3, 'tank-375-16');
  below(craft, core4, 'eng-heavy-12000');
  radial(craft, core4, 'fin-large', 4, yOf(craft, core4) - 5);
  return finish(craft);
}

/** A heavy-lift stack with solid boosters and an ion tug for deep space. */
function titanTug(): Craft {
  const { craft, root } = startCraft('Atlas heavy interplanetary stack', 'probe-core');
  above(craft, root, 'cone-125');
  const ionTank = below(craft, root, 'tank-xenon');
  const ionTank2 = below(craft, ionTank, 'tank-xenon');
  const ion = below(craft, ionTank2, 'eng-ion');
  radial(craft, ionTank, 'solar-large', 2, yOf(craft, ionTank), 0);
  radial(craft, ionTank2, 'battery-small', 2, yOf(craft, ionTank2), Math.PI / 2);
  const dec1 = below(craft, ion, 'dec-125');
  const adapter = below(craft, dec1, 'adapter-125-250');
  const transferTank = below(craft, adapter, 'tank-250-4');
  const transferEngine = below(craft, transferTank, 'eng-vac-600');
  const dec2 = below(craft, transferEngine, 'dec-250');
  const adapter2 = below(craft, dec2, 'adapter-250-375');
  const core = below(craft, adapter2, 'tank-375-16');
  const coreTank2 = below(craft, core, 'tank-375-8');
  below(craft, coreTank2, 'eng-heavy-4500');
  const decs = radial(craft, core, 'dec-radial', 2, yOf(craft, core) - 4, 0);
  onDecoupler(craft, decs[0]!, 'srb-large');
  radial(craft, coreTank2, 'fin-large', 4, yOf(craft, coreTank2) - partDef('tank-375-8').height / 2 + 1.5);
  return finish(craft);
}

export const EXAMPLES: ExampleCraft[] = [
  { id: 'sparrow', title: 'Sparrow-1: basic orbital rocket', blurb: 'Two stages, fins, parachute: a first rocket for low Earth orbit.', build: sparrow },
  { id: 'selene', title: 'Selene: complete Moon mission', blurb: 'A 950 t two-stage launcher under a transfer stage, a lander with legs, and a capsule with a heat shield for the trip home.', build: selene },
  { id: 'selene-module', title: 'Selene module: Moon stack without a launcher', blurb: 'The 40 t part of Selene that does the Moon trip. Start it in orbit from the pause menu, or build your own launcher.', build: seleneModule, orbitOnly: true },
  { id: 'atlas', title: 'Atlas: heavy interplanetary stack', blurb: 'Solid boosters, a heavy core, a 2.5 m transfer stage and an ion tug for deep space.', build: titanTug },
];

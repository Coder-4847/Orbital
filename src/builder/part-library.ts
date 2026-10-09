import type { EngineSpec, PartCategory, PartDef } from './part-types';

/**
 * The built-in part catalogue. Sizes follow four standard diameters (0.625, 1.25, 2.5 and 3.75 m); a stack node joins another
 * node of the same size (use an adapter to change size). Numbers are loosely modelled on real hardware.
 */

const PI = Math.PI;
/** Bulk density of propellant in a tank, including ullage (kg/m^3). */
const PROPELLANT_DENSITY = 950;

const base = (p: Partial<PartDef> & Pick<PartDef, 'id' | 'name' | 'category' | 'look' | 'height' | 'radius' | 'dryMass' | 'blurb'>): PartDef => ({
  cd: 0.2,
  cpWeight: 0.2 * 2 * p.radius * p.height * 0.2,
  crashTolerance: 8,
  maxTemp: 1200,
  ...p,
});

function tank(diameter: number, length: number, name: string): PartDef {
  const r = diameter / 2;
  const prop = Math.round(PI * r * r * length * PROPELLANT_DENSITY);
  return base({
    id: `tank-${diameter * 100}-${length}`,
    name,
    category: 'tank',
    look: 'tank',
    blurb: `${diameter} m propellant tank, ${length} m long.`,
    height: length,
    radius: r,
    dryMass: Math.round(prop * 0.06 + 40 * diameter),
    topSize: diameter,
    bottomSize: diameter,
    hostsSurface: true,
    propellant: { kind: 'lfox', mass: prop },
    crashTolerance: 9,
  });
}

function engine(id: string, name: string, diameter: number, height: number, mass: number, spec: EngineSpec, blurb: string, look: PartDef['look'] = 'engine'): PartDef {
  return base({
    id,
    name,
    category: 'engine',
    look,
    blurb,
    height,
    radius: diameter / 2,
    dryMass: mass,
    topSize: diameter,
    bottomSize: diameter, // lets a decoupler or interstage hang below the engine
    cd: 0.3,
    cpWeight: 0.05,
    maxTemp: 2400,
    crashTolerance: 6,
    engine: spec,
  });
}

function decoupler(diameter: number, mass: number): PartDef {
  return base({
    id: `dec-${diameter * 100}`,
    name: `Decoupler ${diameter} m`,
    category: 'decoupler',
    look: 'decoupler',
    blurb: `Separates the stack when staged (${diameter} m). Everything below it, away from the command pod, is released.`,
    height: 0.2,
    radius: diameter / 2,
    dryMass: mass,
    topSize: diameter,
    bottomSize: diameter,
    hostsSurface: true,
    decoupler: true,
    crashTolerance: 12,
  });
}

function adapter(top: number, bottom: number, height: number, mass: number): PartDef {
  return base({
    id: `adapter-${top * 100}-${bottom * 100}`,
    name: `Adapter ${top} to ${bottom} m`,
    category: 'structural',
    look: 'adapter',
    blurb: `Joins a ${top} m part above to a ${bottom} m part below.`,
    height,
    radius: Math.max(top, bottom) / 2,
    radiusTop: top / 2,
    radiusBottom: bottom / 2,
    dryMass: mass,
    topSize: top,
    bottomSize: bottom,
    hostsSurface: true,
    cpWeight: 0.35,
  });
}

const kN = 1000;

export const PART_LIBRARY: PartDef[] = [
  // --- Command ---
  base({ id: 'pod-capsule', name: 'Capsule', category: 'command', look: 'pod', blurb: 'One-seat crew capsule with reaction wheels.', height: 1.1, radius: 0.625, dryMass: 800, topSize: 0.625, bottomSize: 1.25, crew: 1, torque: 5, charge: { capacity: 150 }, crashTolerance: 14, maxTemp: 1200, cpWeight: 0.3, cd: 0.25 }),
  base({ id: 'pod-cabin', name: 'Crew cabin', category: 'command', look: 'pod', blurb: 'Three-seat 2.5 m command cabin.', height: 2.2, radius: 1.25, dryMass: 3400, topSize: 1.25, bottomSize: 2.5, crew: 3, torque: 20, charge: { capacity: 400 }, crashTolerance: 12, maxTemp: 1200, cd: 0.25 }),
  base({ id: 'pod-lander', name: 'Lander can', category: 'command', look: 'pod', blurb: 'Compact two-seat cabin for landings, with wide windows.', height: 1.6, radius: 0.625, dryMass: 1500, topSize: 1.25, bottomSize: 1.25, crew: 2, torque: 8, charge: { capacity: 300 }, crashTolerance: 10 }),
  base({ id: 'probe-core', name: 'Probe core', category: 'command', look: 'probe', blurb: 'Uncrewed flight computer with a small battery.', height: 0.4, radius: 0.625, dryMass: 130, topSize: 1.25, bottomSize: 1.25, torque: 2, charge: { capacity: 80 }, crashTolerance: 9 }),

  // --- Fuel tanks ---
  tank(1.25, 1, 'Tank 1.25 m short'),
  tank(1.25, 2, 'Tank 1.25 m'),
  tank(1.25, 4, 'Tank 1.25 m long'),
  tank(2.5, 2, 'Tank 2.5 m short'),
  tank(2.5, 4, 'Tank 2.5 m'),
  tank(2.5, 8, 'Tank 2.5 m long'),
  tank(3.75, 4, 'Tank 3.75 m short'),
  tank(3.75, 8, 'Tank 3.75 m'),
  tank(3.75, 16, 'Tank 3.75 m long'),
  base({ id: 'tank-xenon', name: 'Xenon tank', category: 'tank', look: 'tank', blurb: 'High-pressure xenon for ion engines.', height: 1, radius: 0.625, dryMass: 40, topSize: 1.25, bottomSize: 1.25, hostsSurface: true, propellant: { kind: 'xenon', mass: 400 } }),

  // --- Engines ---
  engine('eng-spark', 'Spark', 1.25, 0.9, 90, { thrustSL: 24 * kN, thrustVac: 30 * kN, ispSL: 250, ispVac: 320, gimbal: 3, minThrottle: 0.1, propellant: 'lfox' }, 'Small upper-stage engine.'),
  engine('eng-vacuum-110', 'Vac-110', 1.25, 1.8, 190, { thrustSL: 45 * kN, thrustVac: 110 * kN, ispSL: 190, ispVac: 435, gimbal: 4, minThrottle: 0.05, propellant: 'lfox' }, 'High-efficiency vacuum engine for upper stages.'),
  engine('eng-sea-850', 'Falcon-850', 1.25, 1.7, 470, { thrustSL: 845 * kN, thrustVac: 914 * kN, ispSL: 282, ispVac: 311, gimbal: 5, minThrottle: 0.4, propellant: 'lfox' }, 'Sea-level workhorse for small first stages.'),
  engine('eng-booster-2500', 'Titan-2500', 2.5, 3.2, 1600, { thrustSL: 2400 * kN, thrustVac: 2600 * kN, ispSL: 285, ispVac: 310, gimbal: 4, minThrottle: 0.5, propellant: 'lfox' }, 'High-thrust booster engine.'),
  engine('eng-heavy-4500', 'Atlas-4500', 3.75, 4.2, 3200, { thrustSL: 4500 * kN, thrustVac: 4900 * kN, ispSL: 290, ispVac: 315, gimbal: 3, minThrottle: 0.6, propellant: 'lfox' }, 'Heavy-lift first-stage engine.'),
  engine('eng-heavy-12000', 'Saturn-12000', 3.75, 5.2, 8500, { thrustSL: 12000 * kN, thrustVac: 13000 * kN, ispSL: 310, ispVac: 338, gimbal: 3, minThrottle: 0.6, propellant: 'lfox' }, 'Super-heavy first-stage engine for moon rockets.'),
  engine('eng-vac-600', 'Vac-600', 2.5, 3.0, 1500, { thrustSL: 150 * kN, thrustVac: 600 * kN, ispSL: 200, ispVac: 440, gimbal: 3, minThrottle: 0.1, propellant: 'lfox' }, '2.5 m vacuum engine for large upper and transfer stages.'),
  engine('eng-vac-1500', 'Vac-1500', 2.5, 3.4, 2400, { thrustSL: 330 * kN, thrustVac: 1500 * kN, ispSL: 220, ispVac: 450, gimbal: 3, minThrottle: 0.1, propellant: 'lfox' }, 'Powerful 2.5 m vacuum engine for the upper stage of a big rocket.'),
  engine('eng-ion', 'Ion drive', 1.25, 0.8, 300, { thrustSL: 50, thrustVac: 4 * kN, ispSL: 100, ispVac: 4200, gimbal: 0, minThrottle: 0, propellant: 'xenon', electric: 9 }, 'Extremely efficient, extremely gentle. Needs xenon and electricity.', 'ion'),
  base({
    id: 'srb-large',
    name: 'Solid booster',
    category: 'engine',
    look: 'solid',
    blurb: 'Solid rocket motor with its own propellant. Cannot be throttled or shut down.',
    height: 8,
    radius: 0.625,
    dryMass: 1100,
    topSize: 1.25,
    surface: true,
    cd: 0.25,
    maxTemp: 1500,
    propellant: { kind: 'solid', mass: 9000 },
    engine: { thrustSL: 1100 * kN, thrustVac: 1200 * kN, ispSL: 230, ispVac: 250, gimbal: 0, minThrottle: 1, propellant: 'solid' },
  }),

  // --- Decouplers ---
  decoupler(1.25, 50),
  decoupler(2.5, 160),
  decoupler(3.75, 380),
  base({ id: 'dec-radial', name: 'Radial decoupler', category: 'decoupler', look: 'decoupler', blurb: 'Releases a booster or tank attached to the side of the rocket.', height: 0.3, radius: 0.2, dryMass: 45, surface: true, decoupler: true }),

  // --- Nose cones & fairings ---
  base({ id: 'cone-0625', name: 'Nose cone 0.625 m', category: 'aero', look: 'cone', blurb: 'Small streamlined nose.', height: 0.6, radius: 0.3125, dryMass: 20, bottomSize: 0.625, cd: 0.1, cpWeight: 0.05 }),
  base({ id: 'cone-125', name: 'Nose cone 1.25 m', category: 'aero', look: 'cone', blurb: 'Streamlined nose for 1.25 m stacks.', height: 1.4, radius: 0.625, dryMass: 70, bottomSize: 1.25, cd: 0.08, cpWeight: 0.15 }),
  base({ id: 'cone-250', name: 'Nose cone 2.5 m', category: 'aero', look: 'cone', blurb: 'Streamlined nose for 2.5 m stacks.', height: 2.6, radius: 1.25, dryMass: 280, bottomSize: 2.5, cd: 0.08, cpWeight: 0.5 }),
  base({ id: 'fairing-250', name: 'Fairing 2.5 m', category: 'aero', look: 'fairing', blurb: 'Large ogive fairing: low drag for tall, wide payloads.', height: 4.5, radius: 1.25, dryMass: 450, bottomSize: 2.5, cd: 0.06, cpWeight: 0.7 }),

  // --- Structural ---
  adapter(1.25, 2.5, 0.9, 140),
  adapter(2.5, 3.75, 1.2, 380),
  adapter(0.625, 1.25, 0.5, 40),
  base({ id: 'interstage-250', name: 'Interstage 2.5 m', category: 'structural', look: 'decoupler', blurb: 'Hollow structural ring that keeps an engine clear of the stage below.', height: 1.2, radius: 1.25, dryMass: 220, topSize: 2.5, bottomSize: 2.5, hostsSurface: true }),

  // --- Fins & control surfaces ---
  base({ id: 'fin-small', name: 'Fin small', category: 'fins', look: 'fin', blurb: 'Fixed stabiliser. Moves the centre of pressure back.', height: 1.2, radius: 0.5, dryMass: 30, surface: true, cd: 0.05, cpWeight: 1.2, crashTolerance: 5 }),
  base({ id: 'fin-large', name: 'Fin large', category: 'fins', look: 'fin', blurb: 'Large fixed stabiliser.', height: 2.4, radius: 1, dryMass: 130, surface: true, cd: 0.06, cpWeight: 4.5, crashTolerance: 5 }),
  base({ id: 'fin-control', name: 'Control fin', category: 'fins', look: 'fin', blurb: 'Hinged fin that steers in the atmosphere.', height: 1.6, radius: 0.7, dryMass: 80, surface: true, cd: 0.06, cpWeight: 2.2, control: 1, crashTolerance: 5 }),

  // --- Landing legs ---
  base({ id: 'leg-small', name: 'Landing leg small', category: 'landing', look: 'leg', blurb: 'Folding landing leg for light landers.', height: 1.8, radius: 0.45, dryMass: 40, surface: true, crashTolerance: 14 }),
  base({ id: 'leg-large', name: 'Landing leg large', category: 'landing', look: 'leg', blurb: 'Heavy folding landing leg.', height: 3.2, radius: 0.7, dryMass: 160, surface: true, crashTolerance: 18 }),

  // --- Parachutes ---
  base({ id: 'chute-drogue', name: 'Drogue chute', category: 'parachute', look: 'chute', blurb: 'Small chute that slows a fast descent. Mounts on top of a 0.625 m node.', height: 0.3, radius: 0.2, dryMass: 20, bottomSize: 0.625, cd: 0.1 }),
  base({ id: 'chute-main', name: 'Main chute', category: 'parachute', look: 'chute', blurb: 'Big canopy for a soft landing. A drogue chute can sit on top of it.', height: 0.5, radius: 0.35, dryMass: 100, topSize: 0.625, bottomSize: 0.625, cd: 0.1 }),
  base({ id: 'chute-radial', name: 'Radial chute', category: 'parachute', look: 'chute', blurb: 'Side-mounted chute pack for boosters and landers.', height: 0.5, radius: 0.25, dryMass: 60, surface: true }),

  // --- Heat shields ---
  base({ id: 'shield-125', name: 'Heat shield 1.25 m', category: 'heatshield', look: 'shield', blurb: 'Ablative shield for atmospheric entry.', height: 0.25, radius: 0.625, dryMass: 220, topSize: 1.25, bottomSize: 1.25, maxTemp: 3600, cd: 0.4, crashTolerance: 20 }),
  base({ id: 'shield-250', name: 'Heat shield 2.5 m', category: 'heatshield', look: 'shield', blurb: 'Large ablative shield for atmospheric entry.', height: 0.4, radius: 1.25, dryMass: 900, topSize: 2.5, bottomSize: 2.5, maxTemp: 3600, cd: 0.4, crashTolerance: 20 }),

  // --- Power ---
  base({ id: 'solar-small', name: 'Solar panel small', category: 'power', look: 'panel', blurb: 'Fixed solar panel.', height: 1, radius: 0.5, dryMass: 15, surface: true, charge: { generation: 1.4 }, cd: 0.05 }),
  base({ id: 'solar-large', name: 'Solar panel large', category: 'power', look: 'panel', blurb: 'Large solar panel.', height: 2, radius: 1, dryMass: 60, surface: true, charge: { generation: 5.5 }, cd: 0.05 }),
  base({ id: 'battery-small', name: 'Battery small', category: 'power', look: 'battery', blurb: 'Small battery block.', height: 0.3, radius: 0.15, dryMass: 10, surface: true, charge: { capacity: 100 } }),
  base({ id: 'battery-large', name: 'Battery stack', category: 'power', look: 'battery', blurb: 'Battery in stack form (1.25 m).', height: 0.5, radius: 0.625, dryMass: 120, topSize: 1.25, bottomSize: 1.25, hostsSurface: true, charge: { capacity: 1200 } }),

  // --- RCS & reaction wheels ---
  base({ id: 'rcs-block', name: 'RCS block', category: 'rcs', look: 'rcs', blurb: 'Four-way thruster block. Uses the stack propellant.', height: 0.3, radius: 0.15, dryMass: 12, surface: true, rcsThrust: 1000 }),
  base({ id: 'wheel-small', name: 'Reaction wheel 1.25 m', category: 'sas', look: 'wheel', blurb: 'Gyroscopic attitude control.', height: 0.4, radius: 0.625, dryMass: 100, topSize: 1.25, bottomSize: 1.25, hostsSurface: true, torque: 15, charge: { use: 0.4 } }),
  base({ id: 'wheel-large', name: 'Reaction wheel 2.5 m', category: 'sas', look: 'wheel', blurb: 'Strong gyroscopic attitude control.', height: 0.6, radius: 1.25, dryMass: 600, topSize: 2.5, bottomSize: 2.5, hostsSurface: true, torque: 90, charge: { use: 1.2 } }),
];

const BY_ID = new Map(PART_LIBRARY.map((p) => [p.id, p]));

export function partDef(id: string): PartDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown part "${id}"`);
  return def;
}

export const hasPart = (id: string): boolean => BY_ID.has(id);

export const partsInCategory = (c: PartCategory): PartDef[] => PART_LIBRARY.filter((p) => p.category === c);

/**
 * Part definitions: pure data. Everything the builder, the stats and (later) the flight physics need to know about a part.
 * Units: metres, kilograms, newtons, seconds. A part's origin is the centre of its bounding cylinder, local +Y is "up"
 * (towards the nose). Radial parts extend along local +X from their attachment point on the parent's surface.
 */

export type PartCategory =
  | 'command'
  | 'tank'
  | 'engine'
  | 'decoupler'
  | 'aero'
  | 'fins'
  | 'landing'
  | 'parachute'
  | 'heatshield'
  | 'power'
  | 'rcs'
  | 'sas'
  | 'structural';

export const CATEGORY_LABELS: Record<PartCategory, string> = {
  command: 'Command',
  tank: 'Fuel tanks',
  engine: 'Engines',
  decoupler: 'Decouplers',
  aero: 'Nose & fairings',
  fins: 'Fins',
  landing: 'Landing legs',
  parachute: 'Parachutes',
  heatshield: 'Heat shields',
  power: 'Power',
  rcs: 'RCS',
  sas: 'Reaction wheels',
  structural: 'Structural',
};

/** How the part is drawn (see part-meshes.ts). */
export type PartLook =
  | 'pod'
  | 'probe'
  | 'tank'
  | 'engine'
  | 'ion'
  | 'solid'
  | 'cone'
  | 'fairing'
  | 'adapter'
  | 'decoupler'
  | 'fin'
  | 'leg'
  | 'chute'
  | 'shield'
  | 'panel'
  | 'battery'
  | 'rcs'
  | 'wheel';

export type PropellantKind = 'lfox' | 'xenon' | 'solid';

export interface EngineSpec {
  /** Thrust (N) and specific impulse (s) at sea level (1 atm) and in vacuum; both interpolate linearly with pressure. */
  thrustSL: number;
  thrustVac: number;
  ispSL: number;
  ispVac: number;
  /** Maximum gimbal deflection (degrees). */
  gimbal: number;
  /** Lowest throttle setting (1 = cannot throttle, e.g. solid boosters). */
  minThrottle: number;
  propellant: PropellantKind;
  /** Electric charge used per second at full thrust (ion engines). */
  electric?: number;
}

export interface PartDef {
  id: string;
  name: string;
  category: PartCategory;
  blurb: string;
  look: PartLook;
  height: number;
  /** Body radius; for tapered parts the radii at the top and bottom. */
  radius: number;
  radiusTop?: number;
  radiusBottom?: number;
  dryMass: number;
  /** Stack attachment nodes: diameter (m) of the node at the top / bottom of the part, if it has one. */
  topSize?: number;
  bottomSize?: number;
  /** Can be attached to the side of a cylindrical part (fins, legs, boosters, panels...). */
  surface?: boolean;
  /** Can host radially attached parts on its side. */
  hostsSurface?: boolean;
  /** Propellant carried (kg), and which pool it feeds. */
  propellant?: { kind: PropellantKind; mass: number };
  engine?: EngineSpec;
  /** Separates everything beyond it (away from the root) when staged. */
  decoupler?: boolean;
  /** Aerodynamics: frontal drag coefficient and the weight this part has in the centre-of-pressure estimate (m^2 equivalent). */
  cd: number;
  cpWeight: number;
  /** Impacts above this speed (m/s) break the part; skin temperature (K) above which it is destroyed. */
  crashTolerance: number;
  maxTemp: number;
  /** Electric charge: storage (EC), generation (EC/s) and continuous use (EC/s). */
  charge?: { capacity?: number; generation?: number; use?: number };
  /** Control authority: reaction wheel torque (kN m), RCS thrust (N), control surface deflection authority (0..1). */
  torque?: number;
  rcsThrust?: number;
  control?: number;
  /** Crew seats. */
  crew?: number;
}

/** Total mass of a part when full (kg). */
export const wetMass = (d: PartDef): number => d.dryMass + (d.propellant?.mass ?? 0);

export const isEngine = (d: PartDef): boolean => d.engine !== undefined;

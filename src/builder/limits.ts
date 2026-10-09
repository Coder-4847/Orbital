/**
 * Build limits and craft sanity checks. The limits stand in for the size of the hangar and the pad; the "unlimited building
 * space" cheat lifts them. Warnings are advice, never blocks.
 */
import { buildTree, craftBounds, type Craft } from './craft';
import { partDef } from './part-library';
import { stageCount } from './staging';
import { simulateStages, computeStats } from './stats';

export const LIMITS = {
  maxParts: 120,
  /** Overall height and width of the craft (m): the hangar door. */
  maxHeight: 130,
  maxWidth: 24,
  maxMass: 2_000_000,
};

export interface Advice {
  level: 'warning' | 'info';
  text: string;
}

/** Why this craft is over the hangar limits (empty when it fits). */
export function limitViolations(c: Craft): string[] {
  const out: string[] = [];
  if (c.parts.length > LIMITS.maxParts) out.push(`Too many parts (${c.parts.length} of ${LIMITS.maxParts}).`);
  if (c.parts.length === 0) return out;
  const b = craftBounds(c);
  const height = b.max[1] - b.min[1];
  const width = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
  if (height > LIMITS.maxHeight) out.push(`Too tall (${height.toFixed(1)} m of ${LIMITS.maxHeight} m).`);
  if (width > LIMITS.maxWidth) out.push(`Too wide (${width.toFixed(1)} m of ${LIMITS.maxWidth} m).`);
  const mass = computeStats(c).wetMass;
  if (mass > LIMITS.maxMass) out.push(`Too heavy (${(mass / 1000).toFixed(0)} t of ${LIMITS.maxMass / 1000} t).`);
  return out;
}

/** Things worth telling the player before they launch. */
export function adviceFor(c: Craft): Advice[] {
  const out: Advice[] = [];
  if (c.parts.length === 0) return out;
  if (!c.parts.some((p) => partDef(p.def).category === 'command')) out.push({ level: 'warning', text: 'No command part: nobody can fly this craft.' });
  const engines = c.parts.filter((p) => partDef(p.def).engine);
  if (engines.length === 0) {
    out.push({ level: 'warning', text: 'No engines.' });
  } else {
    const tree = buildTree(c);
    if (tree) {
      const burning = simulateStages(c, 0);
      if (burning.every((s) => s.dv === 0)) out.push({ level: 'warning', text: 'The engines have no propellant: add a tank in the same stack segment (above the engine, before any decoupler).' });
    }
    if (engines.every((e) => e.stage < 0)) out.push({ level: 'warning', text: 'No engine is staged.' });
  }
  const stats = computeStats(c);
  if (stats.twrSL > 0 && stats.twrSL < 1) out.push({ level: 'warning', text: `Thrust-to-weight at launch is ${stats.twrSL.toFixed(2)}: it will not leave the pad.` });
  if (stats.stabilityMargin !== null && stats.stabilityMargin < 0 && c.parts.some((p) => partDef(p.def).cpWeight > 0.5)) {
    out.push({ level: 'info', text: 'The centre of pressure is above the centre of mass: the rocket may tumble in the atmosphere (add fins at the bottom).' });
  }
  if (stageCount(c) === 0 && engines.length > 0) out.push({ level: 'info', text: 'Nothing is staged yet.' });
  return out;
}

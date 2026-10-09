import { BODY_PROFILES } from './body-profiles';
import { EarthSource, type EarthData } from './earth-source';
import { MoonSource } from './moon-source';
import { ProceduralBodySource } from './procedural-source';
import { SphereSource } from './sphere-source';
import { BODIES } from '../data/solar-system';
import type { TerrainSource } from './types';

/** Ids of every body that has terrain. */
export const TERRAIN_BODY_IDS: readonly string[] = ['earth', 'moon', ...Object.keys(BODY_PROFILES)];

/** Smooth-sphere bodies: the Sun and the gas giants. */
const SPHERE_BODIES = new Map(BODIES.filter((b) => b.render !== 'terrain').map((b) => [b.id, b.radius]));

export const ALL_RENDERED_BODY_IDS: readonly string[] = BODIES.map((b) => b.id);

/** Build the height source for a body. Earth needs its baked rasters; the rest are procedural. */
export function createTerrainSource(id: string, earthData?: EarthData): TerrainSource {
  if (id === 'earth') {
    if (!earthData) throw new Error('Earth terrain needs its data rasters');
    return new EarthSource(earthData);
  }
  if (id === 'moon') return new MoonSource();
  const sphere = SPHERE_BODIES.get(id);
  if (sphere !== undefined) return new SphereSource(id, sphere);
  const profile = BODY_PROFILES[id];
  if (!profile) throw new Error(`No terrain for body "${id}"`);
  return new ProceduralBodySource(profile);
}

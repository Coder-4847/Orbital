/**
 * Bridge between the rendered solar system and the flight physics: the host that poses the real planets and answers ground
 * height questions with the very same terrain function the renderer draws, so a rocket touches exactly what you see.
 */
import { Vector3 } from 'three/webgpu';
import type { SolarSystem } from '../render/solar-system';
import type { BodyHost } from './body-env';

export function systemHost(system: SolarSystem): BodyHost {
  const scratch = new Vector3();
  return {
    ephemeris: system.ephemeris,
    advance: (ut) => system.advance(ut),
    groundHeight(id, p) {
      const planet = system.get(id);
      scratch.set(p[0], p[1], p[2]).add(planet.position);
      return planet.surfaceHeightUnder(scratch);
    },
  };
}

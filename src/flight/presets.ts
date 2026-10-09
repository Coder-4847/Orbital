import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { SolarSystem } from '../render/solar-system';
import type { FreeCamera } from './free-camera';
import { litTimeAt, placeOver, solarTimeAt, subsolarPoint } from './teleport';

/** What the preset viewpoints need from the explorer scene. */
export interface PresetHost {
  /** Universal time (s since J2000); presets may change it to get the lighting they want. */
  ut: number;
  system: SolarSystem;
  camera: PerspectiveCamera;
  free: FreeCamera;
  viewportHeight: number;
  goTo(bodyId: string): void;
}

/** Preset viewpoints that exercise every scale: orbit, mountains, summit, Moon, coast, sunset, Saturn, Mars (keys 1-9, 0). */
export function applyPreset(n: number, host: PresetHost): void {
  const at = (planetId: string, lon: number, lat: number, alt: number, pitch: number, heading: number, hour?: number) => {
    const planet = host.system.get(planetId);
    if (hour !== undefined) host.ut = solarTimeAt(host.ut, lon, hour, planetId);
    host.system.advance(host.ut);
    host.system.place(host.camera, host.free.position, 0, host.viewportHeight); // fresh orientations before placing
    placeOver(host.free, planet, lon, lat, alt, pitch, heading);
  };
  switch (n) {
    case 1: {
      const s = subsolarPoint('earth', host.ut);
      at('earth', s.lon + 12, s.lat * 0.5 + 18, 600_000, 28, 0);
      break;
    }
    case 2:
      at('earth', 9.3, 46.4, 6000, 12, 20, 15);
      break;
    case 3:
      at('earth', 86.55, 27.78, 6500, 8, 40, 14);
      break;
    case 4:
      host.ut = litTimeAt('moon', host.ut, -11.4, -43.3, 0.6);
      at('moon', -11.4, -43.3, 150_000, 40, 0);
      break;
    case 5:
      host.ut = litTimeAt('moon', host.ut, 23.47, 0.67, 0.35);
      at('moon', 23.47, 0.67, 2, 0, 90);
      break;
    case 6: {
      host.system.advance(host.ut);
      const earth = host.system.get('earth');
      const sun = earth.position.clone().negate().normalize();
      const side = new Vector3().crossVectors(sun, new Vector3(0, 1, 0)).normalize();
      const pos = earth.position.clone().addScaledVector(sun, 2.9e7).addScaledVector(side, 1.1e7);
      host.free.placeLooking(pos, earth.position.clone(), new Vector3(0, 1, 0));
      break;
    }
    case 7:
      at('earth', 147.2, -18.6, 9000, 30, 0, 12);
      break;
    case 8:
      at('earth', -35, 35, 25, 4, 270, 18.2);
      break;
    case 9:
      host.goTo('saturn');
      break;
    case 0:
      at('mars', -133.8, 18.65, 30_000, 22, 100, 14);
      break;
  }
}

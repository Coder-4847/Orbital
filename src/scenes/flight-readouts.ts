/** Small pure helpers that turn flight state into what the HUD and the sound engine show. */
import { surfaceVelocity, type FlightEnv } from '../flight/env';
import { vlen, vscale, vsub, type V3 } from '../flight/math3';
import type { BallMarker } from '../flight/navball';
import type { FlightVectors } from '../flight/sas';
import type { Vessel } from '../flight/vessel';
import type { Warp } from '../flight/warp';

export function warpText(w: Warp): string {
  if (w.target !== null) return `warping ×${w.rate.toLocaleString('en-US')}`;
  if (w.rate === 1) return 'real time';
  return w.rails ? `×${w.rate.toLocaleString('en-US')} rails` : `×${w.rate} physics`;
}

export function navballMarkers(f: FlightVectors, maneuverDir: V3 | null | undefined): BallMarker[] {
  const markers: BallMarker[] = [
    { kind: 'prograde', dir: f.prograde },
    { kind: 'retrograde', dir: vscale(f.prograde, -1) },
    { kind: 'normal', dir: f.normal },
    { kind: 'antinormal', dir: vscale(f.normal, -1) },
    { kind: 'radialOut', dir: f.radialOut },
    { kind: 'radialIn', dir: vscale(f.radialOut, -1) },
  ];
  if (maneuverDir) markers.push({ kind: 'maneuver', dir: maneuverDir });
  return markers;
}

export interface SoundLevels {
  /** Engine loudness 0..1. */
  level: number;
  /** Outside pressure relative to sea level, 0..1. */
  ratio: number;
  /** Airspeed (m/s), air density, and how close the camera is (0..1). */
  speed: number;
  density: number;
  close: number;
}

export function soundLevels(v: Vessel, env: FlightEnv, rails: boolean, cameraMode: string, cameraDistance: number): SoundLevels {
  const level = rails ? 0 : Math.sqrt(Math.min(1, v.tele.thrust / 2.5e6));
  const speed = vlen(vsub(v.vel, surfaceVelocity(env, v.pos)));
  const close = cameraMode === 'pad' ? 0.55 : cameraMode === 'nose' ? 1 : Math.min(1, Math.max(0.3, 1.1 - Math.log10(Math.max(cameraDistance, 10)) * 0.3));
  return {
    level,
    ratio: Math.min(1, v.tele.pressure / 101325),
    speed: rails ? 0 : Math.min(speed, 1500),
    density: rails ? 0 : v.tele.density,
    close,
  };
}

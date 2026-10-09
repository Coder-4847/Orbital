import { Vector3 } from 'three';
import { Ephemeris } from '../physics/ephemeris';
import type { Planet } from '../render/planet';
import { directionToLonLat, lonLatToDirection } from '../terrain/cube-sphere';
import type { FreeCamera } from './free-camera';

const DEG = Math.PI / 180;

/**
 * Put the camera `altitude` metres above terrain at (lon, lat) of `planet`, looking towards `headingDeg`
 * (compass bearing) pitched down by `pitchDeg`. Uses the planet's current pose.
 */
export function placeOver(camera: FreeCamera, planet: Planet, lonDeg: number, latDeg: number, altitude: number, pitchDeg: number, headingDeg: number): void {
  const dir = lonLatToDirection(lonDeg * DEG, latDeg * DEG, new Float64Array(3));
  const dirBF = new Vector3(dir[0], dir[1], dir[2]);
  const up = dirBF.clone().applyQuaternion(planet.orientation);
  const ground = planet.source.radius + sampleHeight(planet, dirBF);
  const position = up.clone().multiplyScalar(ground + altitude).add(planet.position);

  // Local east/north in the inertial frame.
  const northBF = new Vector3(0, 1, 0).addScaledVector(dirBF, -dirBF.y).normalize();
  const eastBF = new Vector3().crossVectors(northBF, dirBF).normalize(); // north x up = east
  const north = northBF.applyQuaternion(planet.orientation);
  const east = eastBF.applyQuaternion(planet.orientation);
  const h = headingDeg * DEG;
  const p = pitchDeg * DEG;
  const horizontal = north.clone().multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
  const forward = horizontal.multiplyScalar(Math.cos(p)).addScaledVector(up, -Math.sin(p));
  camera.placeLooking(position, position.clone().addScaledVector(forward, 1000), up);
}

function sampleHeight(planet: Planet, dirBF: Vector3): number {
  const world = dirBF.clone().multiplyScalar(planet.source.radius).applyQuaternion(planet.orientation).add(planet.position);
  return planet.surfaceHeightUnder(world);
}

/** Put the camera at `distanceRadii` body radii from `planet`, on the sunward side and a little above its orbit, looking at it. */
export function placeLookingAt(camera: FreeCamera, planet: Planet, distanceRadii: number): void {
  const toSun = planet.position.clone().negate();
  if (planet.id === 'sun') toSun.set(1, 0.2, 0);
  toSun.normalize();
  const side = new Vector3().crossVectors(toSun, new Vector3(0, 1, 0)).normalize();
  const offset = toSun.multiplyScalar(0.92).addScaledVector(side, 0.35).addScaledVector(new Vector3(0, 1, 0), 0.18).normalize().multiplyScalar(planet.radius * distanceRadii);
  const position = planet.position.clone().add(offset);
  camera.placeLooking(position, planet.position.clone(), new Vector3(0, 1, 0));
}

const eph = new Ephemeris(); // private instance: teleport searches must not disturb the live system

/** Longitude and latitude (degrees) of the subsolar point of a body at universal time `ut`. */
export function subsolarPoint(bodyId: string, ut: number): { lon: number; lat: number } {
  eph.update(ut);
  const st = eph.get(bodyId);
  const sunDir = new Vector3(-st.pos[0], -st.pos[1], -st.pos[2]).normalize();
  const q = { x: st.q[0], y: st.q[1], z: st.q[2], w: st.q[3] };
  const inv = new Vector3().copy(sunDir).applyQuaternion({ ...q, x: -q.x, y: -q.y, z: -q.z } as never);
  const ll = directionToLonLat(inv.x, inv.y, inv.z);
  return { lon: (ll.lon * 180) / Math.PI, lat: (ll.lat * 180) / Math.PI };
}

/** Earth-specific helpers kept for the presets. */
export const subsolarLongitude = (ut: number): number => subsolarPoint('earth', ut).lon;
export const subsolarLatitude = (ut: number): number => subsolarPoint('earth', ut).lat;

/**
 * A universal time near `ut` at which local solar time at `lonDeg` on `bodyId` equals `hour` (0-24, noon = 12): found by
 * Newton iteration on the subsolar longitude, whose rate is measured numerically (so it works for any rotation rate).
 */
export function solarTimeAt(ut: number, lonDeg: number, hour: number, bodyId = 'earth'): number {
  const wrap180 = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
  let t = ut;
  for (let k = 0; k < 5; k++) {
    const target = lonDeg - (hour - 12) * 15;
    const delta = wrap180(subsolarPoint(bodyId, t).lon - target);
    const dt = 600;
    let rate = wrap180(subsolarPoint(bodyId, t + dt).lon - subsolarPoint(bodyId, t).lon) / dt; // deg/s: negative as the planet turns east
    if (Math.abs(rate) < 1e-9) rate = -1e-9;
    t -= delta / rate;
  }
  return t;
}

/**
 * A time within the next `windowDays` days at which the Sun stands at `sinElevation` above the horizon at (lon, lat) of
 * `bodyId`. Searches in steps of window/400, then refines. Used for the Moon, where a lunar day is 29.5 Earth days.
 */
export function litTimeAt(bodyId: string, ut: number, lonDeg: number, latDeg: number, sinElevation = 0.75, windowDays = 30): number {
  const dirBF = lonLatToDirection(lonDeg * DEG, latDeg * DEG, new Float64Array(3));
  const local = new Vector3(dirBF[0], dirBF[1], dirBF[2]);
  const err = (t: number) => {
    eph.update(t);
    const st = eph.get(bodyId);
    const up = local.clone().applyQuaternion({ x: st.q[0], y: st.q[1], z: st.q[2], w: st.q[3] } as never);
    const sun = new Vector3(-st.pos[0], -st.pos[1], -st.pos[2]).normalize();
    return Math.abs(up.dot(sun) - sinElevation);
  };
  const step = (windowDays * 86400) / 400;
  let best = ut;
  let bestErr = Infinity;
  for (let k = 0; k <= 400; k++) {
    const e = err(ut + k * step);
    if (e < bestErr) {
      bestErr = e;
      best = ut + k * step;
    }
  }
  for (let s = step / 2; s > 30; s /= 2) {
    for (const t of [best - s, best + s]) {
      const e = err(t);
      if (e < bestErr) {
        bestErr = e;
        best = t;
      }
    }
  }
  return best;
}

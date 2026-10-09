import { describe, expect, it } from 'vitest';
import { attitude, ballPointToBody, elevationAndBearing, project } from '../src/flight/navball-math';
import { qfromAxisAngle, qfromBasis, qmul, type V3 } from '../src/flight/math3';

const horizon = { up: [0, 1, 0] as V3, east: [1, 0, 0] as V3, north: [0, 0, -1] as V3 };

describe('navball geometry', () => {
  it('the nose points at the centre of the ball and body +X is to the right', () => {
    const p = ballPointToBody(0, 0);
    expect(p).toEqual([0, 1, -0]);
    const right = ballPointToBody(1, 0);
    expect(right[0]).toBeCloseTo(1);
  });

  it('a direction along the nose projects to the centre; one to the side projects to its edge', () => {
    const id = qfromAxisAngle([0, 0, 1], 0);
    const nose = project(id, [0, 1, 0]);
    expect(nose.x).toBeCloseTo(0);
    expect(nose.y).toBeCloseTo(0);
    expect(nose.front).toBe(true);
    const behind = project(id, [0, -1, 0]);
    expect(behind.front).toBe(false);
    const side = project(id, [1, 0, 0]);
    expect(side.x).toBeCloseTo(1);
  });

  it('reads elevation and bearing against the local horizon', () => {
    const up = elevationAndBearing(horizon, [0, 1, 0]);
    expect(up.elevation).toBeCloseTo(Math.PI / 2);
    const east = elevationAndBearing(horizon, [1, 0, 0]);
    expect(east.elevation).toBeCloseTo(0);
    expect(east.bearing).toBeCloseTo(Math.PI / 2);
    const north = elevationAndBearing(horizon, [0, 0, -1]);
    expect(north.bearing).toBeCloseTo(0);
    const southWest = elevationAndBearing(horizon, [-0.7071, 0, 0.7071]);
    expect(southWest.bearing).toBeCloseTo((Math.PI * 5) / 4);
  });

  it('attitude: standing on the pad is pitch 90; tipped over to the east is pitch 0 heading east', () => {
    const upright = qfromBasis([1, 0, 0], [0, 1, 0], [0, 0, 1]); // nose up
    expect(attitude(upright, horizon).pitch).toBeCloseTo(Math.PI / 2);
    const tipped = qmul(qfromAxisAngle([0, 0, 1], -Math.PI / 2), upright); // nose towards +X (east)
    const a = attitude(tipped, horizon);
    expect(a.pitch).toBeCloseTo(0, 5);
    expect(a.heading).toBeCloseTo(Math.PI / 2, 5);
  });
});

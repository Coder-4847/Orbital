/** Advancing the simulation: fixed physics steps, or a hop along the orbit on rails. */
import type { FlightWorld } from '../flight/flight-world';
import type { Navigator } from '../flight/navigator';
import type { Warp } from '../flight/warp';

export const PHYSICS_STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 32;

export interface Stepper {
  /** Simulated seconds waiting to be turned into physics steps. */
  accumulator: number;
}

export interface TimeMessage {
  text: string;
  level?: 'warn';
}

/** Advance the simulation by this frame's share of time. Returns messages for the HUD. */
export function advanceTime(world: FlightWorld, nav: Navigator, warp: Warp, stepper: Stepper, dt: number, now: number): TimeMessage[] {
  const out: TimeMessage[] = [];
  const warpedTo = warp.target !== null;
  const room = warp.update(world.ut, nav.railsBlocker());
  if (warp.rails) {
    const result = nav.advanceRails(Math.min(Math.min(dt, 0.1) * warp.rate, room), now);
    if (result.stopped) {
      warp.reset();
      out.push({ text: result.stopped === 'floor' ? 'Time warp stopped: too close to the surface.' : 'Time warp stopped.', level: 'warn' });
    }
  } else {
    stepper.accumulator = Math.min(stepper.accumulator + Math.min(dt, 0.1) * warp.rate, room, 0.5);
    let steps = 0;
    while (stepper.accumulator >= PHYSICS_STEP && steps < MAX_STEPS_PER_FRAME) {
      world.step(PHYSICS_STEP);
      stepper.accumulator -= PHYSICS_STEP;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) stepper.accumulator = 0;
  }
  if (warpedTo && warp.target === null) out.push({ text: 'Warp complete.' });
  return out;
}

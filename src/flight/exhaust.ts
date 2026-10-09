/** Smoke blasted out from under engines near the ground, and a thin vapour trail in thick air. Spawns into FlightEffects. */
import type { FlightEffects } from './effects';
import type { FlightEnv } from './env';
import { qrot, qrotInv, vadd, vdot, vlen, vnorm, vscale, vsub } from './math3';
import { exhaustPoint, type Vessel } from './vessel';

export class ExhaustEmitter {
  private debt = 0;

  emit(vessels: readonly Vessel[], env: FlightEnv, effects: FlightEffects, dt: number): void {
    if (!env.air) return;
    const q = env.planetQuat;
    for (const v of vessels) {
      for (const p of v.parts) {
        if (p.burn < 0.05 || !p.def.engine || v.tele.density < 0.05) continue;
        const local = exhaustPoint(p);
        const world = vadd(v.pos, qrot(v.q, vsub(local, v.mass.com)));
        const up = vnorm(world);
        const height = vlen(world) - env.groundRadius(world);
        const bell = p.def.radius;
        const rate = Math.min(80, 30 + (p.def.engine.thrustSL / 5e4) * p.burn);
        this.debt += rate * dt;
        while (this.debt >= 1) {
          this.debt -= 1;
          if (height < 160) {
            const dir = vnorm(vadd(vscale(up, 0), [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]));
            const horiz = vnorm(vsub(dir, vscale(up, vdot(dir, up))));
            const groundPoint = vsub(world, vscale(up, height - 0.5));
            const speed = 18 + Math.random() * 40;
            const vel = qrotInv(q, vadd(vscale(horiz, speed), vscale(up, 3 + Math.random() * 6)));
            effects.spawn(false, qrotInv(q, groundPoint), vel, 6 + bell * 4, 30 + bell * 14, 3.5 + Math.random() * 3.5, 0.5, 0.55);
          } else if (height < 18_000) {
            effects.spawn(false, qrotInv(q, world), [0, 0, 0], 1.5 + bell, 7 + bell * 5, 6 + Math.random() * 3, 0.22, 0.2);
          }
        }
      }
    }
  }
}

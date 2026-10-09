/** The numbers the debug overlay shows in flight: frame timing, terrain streaming and the physics. */
import type { AppContext } from '../core/scene-manager';
import type { OverlayInfo } from '../flight/debug-overlay';
import type { FlightWorld } from '../flight/flight-world';
import { vlen } from '../flight/math3';
import type { Vessel } from '../flight/vessel';
import type { Planet } from '../render/planet';
import type { SolarSystem } from '../render/solar-system';

export interface DiagnosticsInput {
  ctx: AppContext;
  system: SolarSystem;
  planet: Planet;
  world: FlightWorld;
  vessel: Vessel;
  warpRate: number;
  rails: boolean;
  exposure: number;
  patches: number;
}

export function collectOverlayInfo(i: DiagnosticsInput): OverlayInfo {
  let drawn = 0;
  let resident = 0;
  let pending = 0;
  let bodies = 0;
  for (const p of i.system.planets) {
    if (!p.resolved) continue;
    bodies++;
    drawn += p.terrain.stats.drawn;
    resident += p.terrain.stats.resident;
    pending += p.terrain.stats.pending;
  }
  const loop = i.ctx.loopStats;
  const w = i.system.workerStats;
  return {
    fps: loop.fps,
    frameMs: loop.frameMs,
    gpuMs: i.ctx.gfx.gpuMs,
    backend: i.ctx.gfx.backend,
    body: i.planet.def.name,
    altitude: Math.max(0, vlen(i.vessel.pos) - i.world.env.radius),
    speed: vlen(i.vessel.vel),
    lat: 0,
    lon: 0,
    warp: i.warpRate,
    exposure: i.exposure,
    terrain: { drawn, resident, pending, level: i.planet.terrain.stats.deepestLevel, bodies },
    soi: i.world.bodyId,
    atmosphere: i.system.atmosphereBody?.def.name ?? 'none',
    workers: { count: w.workers, avgMs: w.avgMs },
    depth: i.ctx.gfx.reversedDepth ? 'reversed-Z' : 'standard',
    extra: [`physics step 1/120 s  vessels ${i.world.vessels.length}  warp ${i.rails ? 'rails' : 'physics'}  trajectory patches ${i.patches}`],
  };
}

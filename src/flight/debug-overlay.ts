import { h } from '../ui/kit/dom';

export interface OverlayInfo {
  fps: number;
  frameMs: number;
  gpuMs: number;
  backend: string;
  body: string;
  altitude: number;
  speed: number;
  lat: number;
  lon: number;
  warp: number;
  exposure: number;
  /** Terrain totals across all bodies, and the deepest LOD level drawn near the camera. */
  terrain: { drawn: number; resident: number; pending: number; level: number; bodies: number };
  /** Body whose sphere of influence the camera is in, and the atmosphere currently drawn. */
  soi: string;
  atmosphere: string;
  workers: { count: number; avgMs: number };
  depth: string;
  /** Extra lines (the flight scene adds the physics step and vessel counts). */
  extra?: string[];
}

export function formatDistance(m: number): string {
  const a = Math.abs(m);
  if (a >= 1e11) return `${(m / 1.495978707e11).toFixed(3)} AU`;
  if (a >= 1e9) return `${(m / 1e9).toFixed(2)} Gm`;
  if (a >= 1e6) return `${(m / 1e6).toFixed(2)} Mm`;
  if (a >= 1e4) return `${(m / 1e3).toFixed(1)} km`;
  if (a >= 1e3) return `${(m / 1e3).toFixed(2)} km`;
  return `${m.toFixed(1)} m`;
}

const HELP = [
  'W A S D  move · R F / Space C  up, down · mouse  look (click to capture) · wheel  speed · Shift fast · Ctrl slow · Q E roll',
  'M  map view · Tab  fly to next body · 1 orbit · 2 Alps · 3 Everest · 4 Moon orbit · 5 Moon · 6 Earth afar · 7 reef · 8 sunset · 9 Saturn · 0 Mars',
  ', .  slower / faster warp · /  real time · [ ]  ±1 hour (Shift: ±1 day) · G  ground collision · F3  overlay · Esc  menu',
].join('\n');

/** F3-style debug readout for the explorer. */
export function createDebugOverlay(helpText: string | null = HELP): { root: HTMLElement; update(info: OverlayInfo): void; toggle(): void; show(on: boolean): void } {
  const stats = h('pre', { class: 'mono debug-stats' });
  const help = h('pre', { class: 'mono debug-help', text: helpText ?? '' });
  const root = h('div', { class: 'debug-overlay' }, stats, help);
  return {
    root,
    toggle: () => root.classList.toggle('is-hidden'),
    show: (on) => root.classList.toggle('is-hidden', !on),
    update(i) {
      stats.textContent = [
        `${i.fps.toFixed(0).padStart(3)} fps  cpu ${i.frameMs.toFixed(1).padStart(5)} ms  gpu ${i.gpuMs > 0 ? i.gpuMs.toFixed(1).padStart(5) : '  n/a'} ms   ${i.backend}  depth: ${i.depth}   exposure x${i.exposure.toFixed(2)}`,
        `${i.body}  alt ${formatDistance(i.altitude)}   speed ${formatDistance(i.speed)}/s   lat ${i.lat.toFixed(3)}  lon ${i.lon.toFixed(3)}`,
        `SOI ${i.soi}   atmosphere ${i.atmosphere}   warp x${i.warp.toLocaleString('en-US')}`,
        `terrain  bodies ${i.terrain.bodies}  drawn ${i.terrain.drawn}  resident ${i.terrain.resident}  pending ${i.terrain.pending}  level ${i.terrain.level}`,
        `workers ${i.workers.count}  avg chunk ${i.workers.avgMs.toFixed(1)} ms`,
      ].join('\n');
    },
  };
}

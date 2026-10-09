import type { ChunkData } from './chunk-builder';
import type { TerrainNode } from './cube-sphere';
import type { EarthData } from './earth-source';
import type { BodyTerrainId } from './types';
import type { FromWorker, ToWorker } from './worker-protocol';

interface Slot {
  worker: Worker;
  busy: boolean;
  ready: boolean;
}

export interface PoolStats {
  workers: number;
  inFlight: number;
  built: number;
  avgMs: number;
}

/**
 * A fixed set of terrain workers. The caller owns scheduling (it re-prioritises every frame);
 * the pool only hands jobs to idle workers and returns finished chunks through `onChunk`.
 */
export class ChunkWorkerPool {
  private slots: Slot[] = [];
  private jobs = new Map<number, { slot: Slot; onDone: (chunk: ChunkData) => void }>();
  private nextId = 1;
  private built = 0;
  private totalMs = 0;

  constructor(size: number, earth: EarthData) {
    for (let k = 0; k < size; k++) {
      const worker = new Worker(new URL('./chunk-worker.ts', import.meta.url), { type: 'module' });
      const slot: Slot = { worker, busy: false, ready: false };
      worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(slot, ev.data);
      worker.onerror = (ev) => console.error('[terrain worker]', ev.message);
      // The rasters are copied to every worker (a few MB each); SharedArrayBuffer would need cross-origin isolation headers.
      worker.postMessage({ type: 'init', earth } satisfies ToWorker);
      this.slots.push(slot);
    }
  }

  /** Pool size that leaves cores for rendering: up to 3 workers. */
  static defaultSize(): number {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    return Math.max(1, Math.min(3, cores - 1));
  }

  get idleCount(): number {
    return this.slots.reduce((n, s) => n + (s.ready && !s.busy ? 1 : 0), 0);
  }

  get stats(): PoolStats {
    return { workers: this.slots.length, inFlight: this.jobs.size, built: this.built, avgMs: this.built ? this.totalMs / this.built : 0 };
  }

  /** Start a job on an idle worker. Returns false if every worker is busy. */
  dispatch(body: BodyTerrainId, node: TerrainNode, onDone: (chunk: ChunkData) => void): boolean {
    const slot = this.slots.find((s) => s.ready && !s.busy);
    if (!slot) return false;
    const id = this.nextId++;
    slot.busy = true;
    this.jobs.set(id, { slot, onDone });
    slot.worker.postMessage({ type: 'build', id, body, node } satisfies ToWorker);
    return true;
  }

  private onMessage(slot: Slot, msg: FromWorker): void {
    if (msg.type === 'ready') {
      slot.ready = true;
      return;
    }
    const job = this.jobs.get(msg.id);
    if (!job) return;
    this.jobs.delete(msg.id);
    slot.busy = false;
    this.built++;
    this.totalMs += msg.ms;
    job.onDone(msg.chunk);
  }

  dispose(): void {
    this.slots.forEach((s) => s.worker.terminate());
    this.slots = [];
    this.jobs.clear();
  }
}

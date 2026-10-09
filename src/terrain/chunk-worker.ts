/// <reference lib="webworker" />
import { buildChunk } from './chunk-builder';
import type { EarthData } from './earth-source';
import { createTerrainSource } from './source-registry';
import type { TerrainSource } from './types';
import type { FromWorker, ToWorker } from './worker-protocol';

const sources = new Map<string, TerrainSource>();
let earthData: EarthData | undefined;

const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    earthData = msg.earth;
    post({ type: 'ready' });
    return;
  }
  let source = sources.get(msg.body);
  if (!source) {
    source = createTerrainSource(msg.body, earthData); // created lazily: most bodies are never visited in a session
    sources.set(msg.body, source);
  }
  const t0 = performance.now();
  const chunk = buildChunk(source, msg.node);
  post({ type: 'chunk', id: msg.id, chunk, ms: performance.now() - t0 }, [chunk.positions.buffer, chunk.normals.buffer, chunk.detail.buffer, chunk.surfA.buffer, chunk.surfB.buffer]);
};

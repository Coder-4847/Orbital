import type { ChunkData } from './chunk-builder';
import type { TerrainNode } from './cube-sphere';
import type { EarthData } from './earth-source';
import type { BodyTerrainId } from './types';

export type ToWorker =
  | { type: 'init'; earth: EarthData }
  | { type: 'build'; id: number; body: BodyTerrainId; node: TerrainNode };

export type FromWorker = { type: 'ready' } | { type: 'chunk'; id: number; chunk: ChunkData; ms: number };

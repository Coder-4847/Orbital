import { BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3, type Material } from 'three/webgpu';
import { buildChunkIndices, type ChunkData } from './chunk-builder';
import { nodeAngularRadius, nodeCenterDirection, nodeEdgeLength, nodeKey, type TerrainNode } from './cube-sphere';
import { isBehindHorizon, shouldSplit, type TerrainQuality } from './lod';
import type { ChunkWorkerPool } from './worker-pool';
import type { BodyTerrainId } from './types';

interface ChunkEntry {
  node: TerrainNode;
  mesh: Mesh;
  /** Bounding-sphere centre in the body-fixed frame (double precision), metres. */
  cx: number;
  cy: number;
  cz: number;
  boundRadius: number;
  /** Node centre direction (unit) and angular radius, for horizon culling. */
  nx: number;
  ny: number;
  nz: number;
  rho: number;
  lastUsed: number;
  splitLast: boolean;
  /** Flat open water: not split beyond FLAT_MAX_LEVEL (waves are shading, not geometry). */
  flat: boolean;
}

/** The per-vertex attributes of a chunk (the shared index buffer is not one of them). */
const VERTEX_ATTRIBUTES = ['position', 'normal', 'aDetail', 'aSurfA', 'aSurfB'] as const;
/** How often (frames) resident chunks are checked for a finished GPU upload. */
const RELEASE_CHECK_FRAMES = 20;

export interface TerrainBodyOptions {
  id: BodyTerrainId;
  radius: number;
  maxHeight: number;
  maxLevel: number;
  material: Material;
  pool: ChunkWorkerPool;
  /**
   * Whether the renderer has copied this attribute to the GPU. Once it has, the CPU copy of a chunk's vertex data (about 300 KB
   * per chunk, 400 MB at High) is dropped. Without it, chunks simply keep their arrays.
   */
  isUploaded?: (attribute: BufferAttribute) => boolean;
  /** Vertex attributes this body's material never reads: not kept on the geometry at all. */
  unused?: ReadonlyArray<(typeof VERTEX_ATTRIBUTES)[number]>;
}

export interface TerrainStats {
  drawn: number;
  resident: number;
  pending: number;
  deepestLevel: number;
}

/** Main-thread time budget (ms) per frame for turning finished chunks into meshes; at least 4 are always created. */
const MESH_BUDGET_MS = 2;
const MIN_MESHES_PER_FRAME = 4;

/** Open ocean is flat, so cells of ~600 m (level 8 on Earth with 64-cell chunks) are as fine as it ever needs to be. */
const FLAT_MAX_LEVEL = 8;

/**
 * One planet's terrain: a cubed-sphere quadtree of chunk meshes that refines around the camera.
 * `group` holds the meshes in the body-fixed frame; the owner positions/rotates it camera-relative every frame
 * (floating origin), then calls update() with the camera expressed in the body-fixed frame.
 *
 * A node is only drawn once its mesh exists, and it is replaced by its four children only when all four exist,
 * so there are never holes while chunks stream in.
 */
export class TerrainBody {
  readonly group = new Group();
  readonly stats: TerrainStats = { drawn: 0, resident: 0, pending: 0, deepestLevel: 0 };

  private readonly chunks = new Map<number, ChunkEntry>();
  private readonly inFlight = new Set<number>();
  private readonly wanted = new Map<number, { node: TerrainNode; priority: number }>();
  private queue: Array<{ key: number; node: TerrainNode; priority: number }> = [];
  private readonly completed: ChunkData[] = [];
  private readonly drawList: ChunkEntry[] = [];
  private readonly shown = new Set<ChunkEntry>();
  /** Chunks whose CPU vertex arrays are still held, waiting for the renderer to upload them. */
  private readonly unreleased = new Set<ChunkEntry>();
  /** Index data is identical for every chunk; each geometry wraps it in its own attribute so disposing one never frees another's buffer. */
  private readonly indexData = buildChunkIndices();
  private frame = 0;
  private active = true;
  private quality: TerrainQuality = { splitFactor: 3.75, maxChunks: 1300 };
  private readonly scratchDir = new Float64Array(3);

  constructor(private readonly opts: TerrainBodyOptions) {
    this.group.name = `terrain-${opts.id}`;
  }

  setQuality(q: TerrainQuality): void {
    this.quality = q;
  }

  /** Highest-resolution level currently drawn near the camera (for the debug overlay). */
  get deepestLevel(): number {
    return this.stats.deepestLevel;
  }

  /**
   * Bodies too small on screen to show terrain are deactivated: their chunks are freed and nothing is requested, so
   * 20 worlds cost nothing until you approach one.
   */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.group.visible = on;
    if (!on) this.release();
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Free every chunk and cancel pending work (in-flight results are discarded when they arrive). */
  release(): void {
    for (const entry of this.chunks.values()) {
      this.group.remove(entry.mesh);
      entry.mesh.geometry.dispose();
    }
    this.chunks.clear();
    this.shown.clear();
    this.unreleased.clear();
    this.drawList.length = 0;
    this.wanted.clear();
    this.queue = [];
    this.completed.length = 0;
    this.stats.drawn = 0;
    this.stats.resident = 0;
    this.stats.pending = 0;
    this.stats.deepestLevel = 0;
  }

  update(camera: Vector3): void {
    if (!this.active) return;
    this.frame++;
    this.drainCompleted();

    this.wanted.clear();
    this.drawList.length = 0;
    const distance = camera.length();
    for (let face = 0; face < 6; face++) this.select({ face, level: 0, i: 0, j: 0 }, camera, distance);

    // Show exactly the selected set.
    for (const entry of this.shown) entry.mesh.visible = false;
    this.shown.clear();
    let deepest = 0;
    this.group.updateMatrix();
    this.group.matrixWorld.copy(this.group.matrix); // the group sits directly under the scene root
    for (const entry of this.drawList) {
      entry.mesh.visible = true;
      entry.mesh.matrixWorld.multiplyMatrices(this.group.matrixWorld, entry.mesh.matrix);
      this.shown.add(entry);
      if (entry.node.level > deepest) deepest = entry.node.level;
    }

    // Refresh the request queue: nearest wanted nodes first. Anything no longer wanted is dropped.
    this.queue = [...this.wanted.entries()].map(([key, w]) => ({ key, node: w.node, priority: w.priority })).sort((a, b) => a.priority - b.priority);
    this.pump();
    this.evict();
    if (this.opts.isUploaded && this.frame % RELEASE_CHECK_FRAMES === 0) this.releaseUploaded(this.opts.isUploaded);

    this.stats.drawn = this.drawList.length;
    this.stats.resident = this.chunks.size;
    this.stats.pending = this.queue.length + this.inFlight.size;
    this.stats.deepestLevel = deepest;
  }

  /** Returns true if this node (or its descendants) produced something to draw (or is hidden), false if it is still loading. */
  private select(node: TerrainNode, camera: Vector3, cameraDistance: number): boolean {
    const key = nodeKey(node.face, node.level, node.i, node.j);
    const entry = this.chunks.get(key);
    if (!entry) {
      const c = nodeCenterDirection(node.face, node.level, node.i, node.j, this.scratchDir);
      const d = Math.hypot(camera.x - c[0]! * this.opts.radius, camera.y - c[1]! * this.opts.radius, camera.z - c[2]! * this.opts.radius);
      this.want(key, node, d);
      return false;
    }
    entry.lastUsed = this.frame;

    if (isBehindHorizon(camera.x, camera.y, camera.z, cameraDistance, entry.nx, entry.ny, entry.nz, entry.rho, this.opts.radius, this.opts.maxHeight)) {
      entry.splitLast = false;
      return true;
    }

    const edge = nodeEdgeLength(this.opts.radius, node.level);
    const dist = Math.max(Math.hypot(camera.x - entry.cx, camera.y - entry.cy, camera.z - entry.cz) - entry.boundRadius, 0);
    // Hysteresis: stay split a little longer than we split, so nodes do not flicker at the threshold.
    const factor = this.quality.splitFactor * (entry.splitLast ? 1.12 : 1);
    if (!(entry.flat && node.level >= FLAT_MAX_LEVEL) && shouldSplit(dist, edge, node.level, this.opts.maxLevel, factor)) {
      const l = node.level + 1;
      const kids: TerrainNode[] = [
        { face: node.face, level: l, i: node.i * 2, j: node.j * 2 },
        { face: node.face, level: l, i: node.i * 2 + 1, j: node.j * 2 },
        { face: node.face, level: l, i: node.i * 2, j: node.j * 2 + 1 },
        { face: node.face, level: l, i: node.i * 2 + 1, j: node.j * 2 + 1 },
      ];
      let allReady = true;
      for (const k of kids) {
        const kk = nodeKey(k.face, k.level, k.i, k.j);
        if (!this.chunks.has(kk)) {
          allReady = false;
          const c = nodeCenterDirection(k.face, k.level, k.i, k.j, this.scratchDir);
          this.want(kk, k, Math.hypot(camera.x - c[0]! * this.opts.radius, camera.y - c[1]! * this.opts.radius, camera.z - c[2]! * this.opts.radius));
        }
      }
      if (allReady) {
        entry.splitLast = true;
        for (const k of kids) this.select(k, camera, cameraDistance);
        return true;
      }
    }
    entry.splitLast = false;
    this.drawList.push(entry);
    return true;
  }

  private want(key: number, node: TerrainNode, priority: number): void {
    if (this.inFlight.has(key)) return;
    const existing = this.wanted.get(key);
    if (!existing) this.wanted.set(key, { node, priority });
  }

  /** Hand queued jobs to idle workers (also called whenever a worker finishes, so workers never wait for the next frame). */
  private pump(): void {
    while (this.queue.length > 0 && this.opts.pool.idleCount > 0) {
      const job = this.queue.shift()!;
      if (this.chunks.has(job.key) || this.inFlight.has(job.key)) continue;
      const started = this.opts.pool.dispatch(this.opts.id, job.node, (chunk) => {
        if (!this.active) {
          this.inFlight.delete(job.key); // body was deactivated while this was being built: discard
          return;
        }
        // Stays in `inFlight` until its mesh exists (see drainCompleted), so it is not requested again meanwhile.
        this.completed.push(chunk);
        this.pump();
      });
      if (!started) break;
      this.inFlight.add(job.key);
    }
  }

  /** Turn finished worker results into meshes within a small per-frame time budget, so frame time stays flat while streaming. */
  private drainCompleted(): void {
    const start = performance.now();
    for (let n = 0; this.completed.length > 0 && (n < MIN_MESHES_PER_FRAME || performance.now() - start < MESH_BUDGET_MS); n++) {
      const data = this.completed.shift()!;
      const key = data.key;
      this.inFlight.delete(key);
      if (this.chunks.has(key)) continue;
      this.chunks.set(key, this.createEntry(data));
    }
  }

  private createEntry(data: ChunkData): ChunkEntry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
    geometry.setAttribute('aDetail', new BufferAttribute(data.detail, 3));
    geometry.setAttribute('aSurfA', new BufferAttribute(data.surfA, 4));
    if (!this.opts.unused?.includes('aSurfB')) geometry.setAttribute('aSurfB', new BufferAttribute(data.surfB, 4));
    geometry.setIndex(new BufferAttribute(this.indexData, 1));
    geometry.boundingSphere = new Sphere(new Vector3(data.boundCenter[0], data.boundCenter[1], data.boundCenter[2]), data.boundRadius);

    const mesh = new Mesh(geometry, this.opts.material);
    mesh.position.set(data.origin[0], data.origin[1], data.origin[2]);
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false; // only drawn chunks get a world matrix (see update()); thousands are resident
    mesh.updateMatrix();
    mesh.visible = false;
    this.group.add(mesh);

    const { face, level, i, j } = data.node;
    const centre = nodeCenterDirection(face, level, i, j, new Float64Array(3));
    const entry: ChunkEntry = {
      node: data.node,
      mesh,
      cx: data.origin[0] + data.boundCenter[0],
      cy: data.origin[1] + data.boundCenter[1],
      cz: data.origin[2] + data.boundCenter[2],
      boundRadius: data.boundRadius,
      nx: centre[0]!,
      ny: centre[1]!,
      nz: centre[2]!,
      rho: nodeAngularRadius(face, level, i, j),
      lastUsed: this.frame,
      splitLast: false,
      flat: data.flat,
    };
    if (this.opts.isUploaded) this.unreleased.add(entry);
    return entry;
  }

  /**
   * Swap the vertex arrays of every chunk the GPU already has for empty ones (the renderer only needs the element type from then
   * on). A chunk counts as uploaded once its positions are: the body's material is fixed, so an attribute it does not read (the
   * Earth material ignores `aSurfB`) is never uploaded and never will be.
   */
  private releaseUploaded(isUploaded: (attribute: BufferAttribute) => boolean): void {
    for (const entry of this.unreleased) {
      const geometry = entry.mesh.geometry;
      const attributes = VERTEX_ATTRIBUTES.map((name) => geometry.getAttribute(name) as BufferAttribute | undefined).filter((a): a is BufferAttribute => !!a);
      if (!isUploaded(attributes[0]!)) continue;
      for (const a of attributes) a.array = new (a.array.constructor as Float32ArrayConstructor)(0);
      this.unreleased.delete(entry);
    }
  }

  /** Free the least-recently-used chunks once over budget. Chunks used in the last 2 seconds are always kept. */
  private evict(): void {
    if (this.chunks.size <= this.quality.maxChunks) return;
    const stale: Array<[number, ChunkEntry]> = [];
    for (const kv of this.chunks) if (kv[1].lastUsed < this.frame - 120 && kv[1].node.level > 0) stale.push(kv);
    stale.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    let excess = this.chunks.size - Math.floor(this.quality.maxChunks * 0.9);
    for (const [key, entry] of stale) {
      if (excess-- <= 0) break;
      this.group.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      this.unreleased.delete(entry);
      this.chunks.delete(key);
    }
  }

  dispose(): void {
    this.release();
    this.group.clear();
  }
}

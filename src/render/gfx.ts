import {
  ACESFilmicToneMapping,
  RenderPipeline,
  WebGPURenderer,
  type Node,
  type PerspectiveCamera,
  type Scene,
} from 'three/webgpu';
import { pass, uniform, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { GraphicsSettings } from '../save/settings';
import { cleanGpuName } from './gpu-name';

export type BackendKind = 'webgpu' | 'webgl2';

export class GraphicsUnavailableError extends Error {
  constructor(public readonly causes: unknown[]) {
    super('Neither WebGPU nor WebGL 2 could be initialised.');
  }
}

export interface BloomParams {
  strength: number;
  radius: number;
  threshold: number;
}

/** What a compose hook receives: the HDR scene colour and its depth, both in render (camera-relative) space. */
export interface ComposeInput {
  color: Node<'vec4'>;
  /** View-space Z of each pixel (negative, metres). For sky pixels this is a huge value; test with `isSky`. */
  viewZ: Node<'float'>;
  /** True where nothing was drawn (cleared depth). */
  isSky: Node<'bool'>;
}

export interface ViewOptions {
  bloom?: BloomParams;
  /** Post-processing applied to the HDR scene before bloom and exposure (atmosphere, clouds...). */
  compose?: (input: ComposeInput) => Node<'vec4'>;
}

const MAX_PIXEL_RATIO = 2.5;

/** GPU timestamp queries cost a little; they run in development or with ?profile in the URL. */
const PROFILE = import.meta.env.DEV || new URLSearchParams(location.search).has('profile');


/**
 * Owns the renderer, canvas and post-processing pipeline.
 * Scenes hand it a (scene, camera) pair via setView(); everything downstream is shared.
 * The same TSL node graph runs on the WebGPU backend and the WebGL2 fallback backend.
 */
export class Gfx {
  /** HDR exposure multiplier applied before tone mapping (auto-exposure will drive this later). */
  readonly exposure = uniform(1);
  /** 0..1 multiplier for fade in/out of the whole frame. */
  readonly fade = uniform(1);

  private pipeline: RenderPipeline;
  private view: { scene: Scene; camera: PerspectiveCamera; options: ViewOptions } | null = null;
  private graphics: Pick<GraphicsSettings, 'resolutionScale' | 'bloom' | 'antialiasing' | 'shadowQuality'>;
  private resizeObserver: ResizeObserver;
  /** False while the container has no usable size (window hidden/minimised): rendering is skipped. */
  private sized = false;
  private passes: Array<{ dispose(): void }> = [];
  /** True when the depth buffer is reversed (near = 1, far = 0): needed for the 1 m .. 1e12 m depth range. */
  readonly reversedDepth: boolean;
  /** Smoothed GPU time of the last frames in ms (needs timestamp queries; 0 when unsupported or profiling is off). */
  gpuMs = 0;
  private profiling: boolean;
  private timestampBusy = false;
  private frameCounter = 0;
  private resizeListeners = new Set<(width: number, height: number) => void>();
  private captureRequests: Array<{ width: number; done: (url: string | null) => void }> = [];

  private constructor(
    readonly renderer: WebGPURenderer,
    readonly canvas: HTMLCanvasElement,
    readonly backend: BackendKind,
    graphics: GraphicsSettings,
    private readonly container: HTMLElement,
  ) {
    this.graphics = graphics;
    this.reversedDepth = (renderer as unknown as { reversedDepthBuffer?: boolean }).reversedDepthBuffer === true;
    this.profiling = PROFILE;
    this.pipeline = new RenderPipeline(renderer);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    container.appendChild(canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Create a renderer, preferring WebGPU and falling back to WebGL2. Throws GraphicsUnavailableError if both fail. */
  static async create(container: HTMLElement, graphics: GraphicsSettings, forceWebGL: boolean, standardDepth = false): Promise<Gfx> {
    const attempts = forceWebGL ? [true] : [false, true];
    const causes: unknown[] = [];
    for (const force of attempts) {
      // A canvas can only ever hold one context type, so every attempt gets a fresh canvas.
      const canvas = document.createElement('canvas');
      canvas.className = 'gfx-canvas';
      try {
        const renderer = new WebGPURenderer({
          canvas,
          antialias: false, // MSAA is applied on the HDR scene pass instead
          // Float reversed-Z gives uniform relative depth precision from centimetres to the solar system. The WebGL2 backend
          // cannot resolve a float MSAA depth buffer (glBlitFramebuffer format mismatch), so it uses the standard-depth path.
          reversedDepthBuffer: !standardDepth && !force,
          trackTimestamp: PROFILE,
          forceWebGL: force,
          powerPreference: 'high-performance',
        });
        await renderer.init();
        const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
        return new Gfx(renderer, canvas, isWebGPU ? 'webgpu' : 'webgl2', graphics, container);
      } catch (err) {
        causes.push(err);
        console.warn(`[gfx] ${force ? 'WebGL2' : 'WebGPU'} initialisation failed`, err);
      }
    }
    throw new GraphicsUnavailableError(causes);
  }

  /** Human-readable renderer description for the About dialog and debug overlay. */
  async describe(): Promise<string> {
    const label = this.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2';
    try {
      if (this.backend === 'webgpu') {
        const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: { vendor?: string; architecture?: string; description?: string } } | null> } }).gpu;
        const info = (await gpu?.requestAdapter())?.info;
        const name = [info?.vendor, info?.architecture || info?.description].filter(Boolean).join(' ');
        return name ? `${label} · ${name}` : label;
      }
      const gl = (this.renderer.backend as { gl?: WebGL2RenderingContext }).gl;
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      const name = ext && gl ? cleanGpuName(String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))) : '';
      return name ? `${label} · ${name}` : label;
    } catch {
      return label;
    }
  }

  get width(): number {
    return this.container.clientWidth;
  }
  get height(): number {
    return this.container.clientHeight;
  }

  onResize(fn: (width: number, height: number) => void): () => void {
    this.resizeListeners.add(fn);
    return () => this.resizeListeners.delete(fn);
  }

  applyGraphics(g: GraphicsSettings): void {
    const pipelineChanged = g.bloom !== this.graphics.bloom || g.antialiasing !== this.graphics.antialiasing;
    const scaleChanged = g.resolutionScale !== this.graphics.resolutionScale;
    this.graphics = g;
    this.renderer.shadowMap.enabled = g.shadowQuality > 0;
    if (scaleChanged) this.resize();
    if (pipelineChanged) this.rebuild();
  }

  setView(scene: Scene, camera: PerspectiveCamera, options: ViewOptions = {}): void {
    this.view = { scene, camera, options };
    this.rebuild();
  }

  clearView(): void {
    this.view = null;
    this.exposure.value = 1; // a scene left at Saturn's or the Moon's night-side exposure must not blow out the next one
  }

  /** (Re)build the post-processing node graph for the current view and quality settings. */
  private rebuild(): void {
    if (!this.view) return;
    const { scene, camera, options } = this.view;
    // Free the previous graph's render targets before building a new one.
    this.passes.forEach((p) => p.dispose());
    this.passes = [];
    const scenePass = pass(scene, camera, { samples: this.graphics.antialiasing ? 4 : 0 });
    this.passes.push(scenePass);
    const hdr = scenePass.getTextureNode('output');
    let color: Node<'vec4'> = hdr;
    if (options.compose) {
      const depth = scenePass.getTextureNode('depth');
      // Exactly the cleared value: far objects (Moon 4e8 m, Sun 1.5e11 m) have tiny but non-zero reversed depth and must not count as sky.
      const isSky = this.reversedDepth ? depth.r.lessThanEqual(0) : depth.r.greaterThanEqual(1);
      color = options.compose({ color: hdr, viewZ: scenePass.getViewZNode(), isSky });
    }
    // Exposure first, so the bloom threshold is in exposed units and means the same thing at noon and at midnight.
    // RGB only: scaling alpha too would make the (premultiplied) canvas clamp the picture to the exposure value.
    color = vec4(color.rgb.mul(this.exposure), 1) as Node<'vec4'>;
    if (this.graphics.bloom && options.bloom) {
      const b = options.bloom;
      const bloomPass = bloom(color, b.strength, b.radius, b.threshold);
      this.passes.push(bloomPass);
      color = vec4(color.rgb.add(bloomPass.rgb), 1) as Node<'vec4'>;
    }
    // Fade runs in linear HDR; tone mapping + sRGB encode are applied by the pipeline afterwards.
    this.pipeline.outputNode = vec4(color.rgb.mul(this.fade), 1);
    this.pipeline.needsUpdate = true;
  }

  render(): void {
    if (!this.view || !this.sized) return;
    this.pipeline.render();
    if (this.captureRequests.length > 0) {
      // read the canvas in the same task as the draw: the swap-chain image is still valid here
      const requests = this.captureRequests.splice(0);
      for (const r of requests) r.done(this.snapshot(r.width));
    }
    if (this.profiling && !this.timestampBusy && ++this.frameCounter % 15 === 0) {
      this.timestampBusy = true;
      this.renderer
        .resolveTimestampsAsync('render')
        .then((ms) => {
          if (typeof ms === 'number' && Number.isFinite(ms)) this.gpuMs = this.gpuMs === 0 ? ms : this.gpuMs * 0.7 + ms * 0.3;
        })
        .catch(() => (this.profiling = false))
        .finally(() => (this.timestampBusy = false));
    }
  }

  /** A small JPEG of the next rendered frame (a data URL), or null if the canvas cannot be read. Used for save thumbnails. */
  capture(width = 320): Promise<string | null> {
    if (!this.view || !this.sized) return Promise.resolve(null);
    return new Promise((done) => this.captureRequests.push({ width, done }));
  }

  private snapshot(width: number): string | null {
    try {
      const w = this.canvas.width;
      const h = this.canvas.height;
      if (w < 2 || h < 2) return null;
      const out = document.createElement('canvas');
      out.width = width;
      out.height = Math.max(1, Math.round((width * h) / w));
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(this.canvas, 0, 0, out.width, out.height);
      return out.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    }
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    // A hidden or minimised window reports 0x0; creating 0-pixel textures floods the console with GPU errors.
    this.sized = w >= 2 && h >= 2;
    if (!this.sized) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * this.graphics.resolutionScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false); // CSS controls the canvas box
    this.resizeListeners.forEach((fn) => fn(w, h));
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

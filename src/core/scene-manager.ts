import type { Gfx } from '../render/gfx';
import type { LoopStats } from './loop';
import type { AudioManager } from '../audio/audio-manager';
import type { MusicPlayer } from '../audio/music';
import type { CheatStore } from '../save/cheats';
import type { SaveRepository } from '../save/saves';
import type { SettingsStore } from '../save/settings';

export type SceneId = 'menu' | 'hangar' | 'flight' | 'explorer';

/** Shared services every scene can use. Created once in main.ts. */
export interface AppContext {
  gfx: Gfx;
  settings: SettingsStore;
  cheats: CheatStore;
  audio: AudioManager;
  music: MusicPlayer;
  saves: SaveRepository;
  scenes: SceneManager;
  /** Live frame statistics from the main loop (fps, CPU frame time). */
  loopStats: LoopStats;
  /** Cached renderer description, e.g. "WebGPU · NVIDIA ...". */
  rendererLabel: string;
  /** Value of Settings > Graphics > backend when the page loaded (changing it needs a reload). */
  bootBackendSetting: 'auto' | 'webgl2';
}

export interface SceneParams {
  saveId?: string;
}

/**
 * A game screen. It owns its THREE.Scene, camera and DOM, and must release everything in exit().
 * The scene calls ctx.gfx.setView(...) in enter() to hand its scene graph to the renderer.
 */
export interface GameScene {
  readonly id: SceneId;
  enter(ctx: AppContext, ui: HTMLElement, params: SceneParams): Promise<void> | void;
  exit(): void;
  update(dt: number, elapsed: number): void;
  resize(width: number, height: number): void;
}

type SceneFactory = () => Promise<GameScene> | GameScene;

const FADE_OUT_S = 0.28;
const LOADING_DELAY_MS = 220;

/** Short tips shown while a heavy scene loads. */
const LOADING_TIPS = [
  'Tip: press M in flight for the map, and click your orbit to place a maneuver node.',
  'Tip: F5 quick saves and F9 quick loads. The game also saves itself every couple of minutes.',
  'Tip: a gravity turn is gentle. Tip the nose east a little at a time and let prograde lead.',
  'Tip: the heat shield goes first on re-entry. Point it along your velocity.',
  'Tip: time warp on rails stops by itself near the atmosphere and the ground.',
  'Tip: engines that are too weak just sit on the pad. Check thrust-to-weight in the Hangar.',
  'Tip: every key can be rebound in Settings > Controls.',
];

const SCENE_NAMES: Record<SceneId, string> = { menu: 'Main menu', hangar: 'Hangar', flight: 'Flight', explorer: 'Explorer' };
const FADE_IN_S = 0.6;

/** Switches between scenes with a fade through black, one transition at a time (last request wins). */
export class SceneManager {
  private factories = new Map<SceneId, SceneFactory>();
  private current: GameScene | null = null;
  private ctx!: AppContext;
  private elapsed = 0;
  private busy = false;
  private pending: { id: SceneId; params: SceneParams } | null = null;
  private fadeTarget = 1;
  private fadeWaiters: Array<() => void> = [];

  constructor(private readonly uiRoot: HTMLElement) {}

  bind(ctx: AppContext): void {
    this.ctx = ctx;
  }

  register(id: SceneId, factory: SceneFactory): void {
    this.factories.set(id, factory);
  }

  get currentId(): SceneId | null {
    return this.current?.id ?? null;
  }

  async goto(id: SceneId, params: SceneParams = {}): Promise<void> {
    if (this.busy) {
      this.pending = { id, params };
      return;
    }
    this.busy = true;
    try {
      let next: { id: SceneId; params: SceneParams } | null = { id, params };
      while (next) {
        this.pending = null;
        await this.transition(next.id, next.params);
        next = this.pending;
      }
    } finally {
      this.busy = false;
    }
  }

  private async transition(id: SceneId, params: SceneParams): Promise<void> {
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`Unknown scene "${id}"`);

    if (this.current) {
      this.uiRoot.classList.add('is-leaving');
      await this.fadeTo(0);
      this.current.exit();
      this.ctx.gfx.clearView();
      this.uiRoot.replaceChildren();
      this.current = null;
    }

    // a slow scene gets a loading card (not a flash of one for the quick ones)
    const loading = document.createElement('div');
    loading.className = 'scene-loading';
    loading.innerHTML = `<div class="loading-title"></div><div class="loading-bar"><span></span></div><p class="loading-tip"></p>`;
    (loading.querySelector('.loading-title') as HTMLElement).textContent = `Loading ${SCENE_NAMES[id]}`;
    (loading.querySelector('.loading-tip') as HTMLElement).textContent = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]!;
    const showTimer = setTimeout(() => this.uiRoot.appendChild(loading), LOADING_DELAY_MS);
    const scene = await factory();
    const ui = document.createElement('div');
    ui.className = `scene-ui scene-${id}`;
    this.uiRoot.appendChild(ui);
    this.elapsed = 0;
    try {
      await scene.enter(this.ctx, ui, params);
    } finally {
      clearTimeout(showTimer);
      loading.classList.add('is-done');
      setTimeout(() => loading.remove(), 500);
    }
    if (this.ctx.gfx.width > 1 && this.ctx.gfx.height > 1) scene.resize(this.ctx.gfx.width, this.ctx.gfx.height);
    this.current = scene;

    this.uiRoot.classList.remove('is-leaving');
    await this.fadeTo(1);
  }

  private fadeTo(target: number): Promise<void> {
    this.fadeTarget = target;
    if (this.ctx.gfx.fade.value === target) return Promise.resolve();
    return new Promise((resolve) => this.fadeWaiters.push(resolve));
  }

  /** Called every frame by the main loop. */
  update(dt: number): void {
    const fade = this.ctx.gfx.fade;
    if (fade.value !== this.fadeTarget) {
      const rate = this.fadeTarget > fade.value ? 1 / FADE_IN_S : 1 / FADE_OUT_S;
      const step = rate * dt;
      const v = fade.value as number;
      fade.value = this.fadeTarget > v ? Math.min(this.fadeTarget, v + step) : Math.max(this.fadeTarget, v - step);
      if (fade.value === this.fadeTarget) {
        const waiters = this.fadeWaiters;
        this.fadeWaiters = [];
        waiters.forEach((resolve) => resolve());
      }
    }
    this.elapsed += dt;
    this.current?.update(dt, this.elapsed);
  }

  resize(width: number, height: number): void {
    this.current?.resize(width, height);
  }
}

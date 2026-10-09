import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/kit.css';
import './ui/styles/menu.css';
import './ui/styles/hangar.css';
import './ui/styles/flight.css';

import { applyInterfaceSettings } from './core/apply-settings';
import { GameLoop } from './core/loop';
import { SceneManager, type AppContext } from './core/scene-manager';
import { Gfx, GraphicsUnavailableError } from './render/gfx';
import { AudioManager } from './audio/audio-manager';
import { MusicPlayer } from './audio/music';
import { installUiSounds } from './audio/ui-sounds';
import { CheatStore } from './save/cheats';
import { SaveRepository } from './save/saves';
import { SETTINGS_KEY, SettingsStore } from './save/settings';
import { suggestPreset } from './render/gpu-name';
import { installTooltips } from './ui/kit/tooltip';
import { showFatal, showGraphicsUnavailable } from './ui/fatal';

/** No settings file yet: this browser has never run the game. */
function isFirstRun(): boolean {
  try {
    return localStorage.getItem(SETTINGS_KEY) === null;
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  const firstRun = isFirstRun();
  const settings = new SettingsStore();
  applyInterfaceSettings(settings.get());
  settings.subscribe((s) => applyInterfaceSettings(s));
  addEventListener('pagehide', () => settings.flush());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && settings.flush());

  installTooltips(() => settings.get().gameplay.tooltips);

  const app = document.getElementById('app')!;
  const uiRoot = document.getElementById('ui-root')!;

  // ?backend=webgl2 forces the compatibility renderer without touching saved settings (handy for testing).
  const forceWebGL = settings.get().graphics.backend === 'webgl2' || new URLSearchParams(location.search).get('backend') === 'webgl2';

  let gfx: Gfx;
  try {
    // ?depth=standard disables reversed-Z, to exercise the fallback used where EXT_clip_control is unavailable.
    gfx = await Gfx.create(app, settings.get().graphics, forceWebGL, new URLSearchParams(location.search).get('depth') === 'standard');
  } catch (err) {
    if (err instanceof GraphicsUnavailableError) showGraphicsUnavailable(err.causes);
    else showFatal('Orbital hit a problem while starting', ['Something unexpected went wrong.'], ['Reload the page to try again.'], String(err));
    return;
  }
  gfx.fade.value = 0; // first scene fades in from black

  const scenes = new SceneManager(uiRoot);
  const loop = new GameLoop({
    fixed: () => {},
    frame: (dt) => {
      scenes.update(dt);
      gfx.render();
    },
  });
  loop.frameCap = settings.get().graphics.frameCap;

  const audio = new AudioManager(settings);
  const music = new MusicPlayer(audio);
  installUiSounds(audio);
  music.start();

  const ctx: AppContext = {
    gfx,
    settings,
    cheats: new CheatStore(),
    audio,
    music,
    saves: new SaveRepository(),
    scenes,
    loopStats: loop.stats,
    rendererLabel: await gfx.describe(),
    bootBackendSetting: settings.get().graphics.backend,
  };
  scenes.bind(ctx);

  // Scenes are code-split so the menu appears without paying for the others.
  scenes.register('menu', async () => new (await import('./scenes/menu-scene')).MenuScene());
  scenes.register('hangar', async () => new (await import('./scenes/hangar-scene')).HangarScene());
  scenes.register('flight', async () => new (await import('./scenes/flight-scene')).FlightScene());
  scenes.register('explorer', async () => new (await import('./scenes/explorer-scene')).ExplorerScene());

  if (firstRun) settings.applyPreset(suggestPreset(ctx.rendererLabel)); // a first-time player starts on a preset that suits the GPU
  gfx.applyGraphics(settings.get().graphics);
  settings.subscribe((next, prev) => {
    if (next.graphics !== prev.graphics) {
      gfx.applyGraphics(next.graphics);
      loop.frameCap = next.graphics.frameCap;
    }
  });
  gfx.onResize((w, h) => scenes.resize(w, h));

  loop.start();
  await scenes.goto('menu');

  const boot = document.getElementById('boot');
  boot?.classList.add('is-done');
  setTimeout(() => boot?.remove(), 800);

  if (import.meta.env.DEV) {
    (window as unknown as { __orbital: unknown }).__orbital = { ctx, loop };
  }
}

boot().catch((err) => {
  console.error(err);
  showFatal('Orbital hit a problem while starting', ['Something unexpected went wrong.'], ['Reload the page to try again.'], String(err));
});

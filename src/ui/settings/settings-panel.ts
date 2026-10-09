import { QUALITY_PRESET_IDS, type QualityPresetId } from '../../data/quality';
import type { AppContext } from '../../core/scene-manager';
import type { GraphicsSettings, Settings } from '../../save/settings';
import { button, field, sectionTitle, segmented, slider, tabs, toggle, type Control } from '../kit/controls';
import { h } from '../kit/dom';
import { openModal, type ModalHandle } from '../kit/modal';
import { buildControlsPanel } from './controls-panel';
import { HINTS_KEY, RESET_HINTS_EVENT } from '../hint-card';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const LEVELS = [
  { value: 0, label: 'Low' },
  { value: 1, label: 'Medium' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Ultra' },
];

/**
 * Opens the settings dialog. Controls write straight to the SettingsStore (which persists and notifies);
 * a store subscription re-syncs every control so presets and Reset are reflected immediately.
 */
export function openSettings(ctx: AppContext): ModalHandle {
  const { settings, gfx } = ctx;
  const syncers: Array<(s: Settings) => void> = [];

  /** Register a control with a reader that pulls its value out of Settings. */
  const bind = <T>(control: Control<T>, read: (s: Settings) => T): HTMLElement => {
    syncers.push((s) => control.set(read(s)));
    return control.el;
  };
  const panel = (...children: Array<HTMLElement | null>) => h('div', null, ...children);

  // ---- Graphics ----
  const presetLabel = h('span', { class: 'field-hint mono' });
  syncers.push((s) => (presetLabel.textContent = s.graphics.preset === 'custom' ? 'Custom: modified from a preset' : ''));
  const reloadBtn = button({ label: 'Reload to apply', variant: 'primary', onClick: () => location.reload() });
  reloadBtn.hidden = true;
  syncers.push((s) => (reloadBtn.hidden = s.graphics.backend === ctx.bootBackendSetting));

  const g = (patch: Partial<GraphicsSettings>) => settings.setGraphics(patch);
  const graphics = panel(
    sectionTitle('Quality'),
    field(
      'Preset',
      'Sets resolution, effects and detail together.',
      bind(
        segmented<QualityPresetId | 'custom'>({
          label: 'Quality preset',
          options: QUALITY_PRESET_IDS.map((id) => ({ value: id, label: titleCase(id) })),
          value: settings.get().graphics.preset,
          onChange: (v) => v !== 'custom' && settings.applyPreset(v),
        }),
        (s) => s.graphics.preset,
      ),
    ),
    presetLabel,
    field(
      'Resolution scale',
      'Render resolution relative to your screen. Lower is faster.',
      bind(
        slider({ label: 'Resolution scale', min: 0.5, max: 1.5, step: 0.05, value: 1, format: pct, onInput: (v) => g({ resolutionScale: v }) }),
        (s) => s.graphics.resolutionScale,
      ),
    ),
    field(
      'Terrain detail',
      'How finely planets are tessellated near you.',
      bind(
        segmented<number>({
          label: 'Terrain detail',
          options: LEVELS,
          value: 2,
          onChange: (v) => g({ terrainDetail: v as GraphicsSettings['terrainDetail'] }),
        }),
        (s) => s.graphics.terrainDetail,
      ),
    ),
    field(
      'Atmosphere & clouds',
      'Sample count for the sky, aerial perspective and cloud shading.',
      bind(
        segmented<number>({
          label: 'Atmosphere and cloud quality',
          options: LEVELS,
          value: 2,
          onChange: (v) => g({ cloudQuality: v as GraphicsSettings['cloudQuality'] }),
        }),
        (s) => s.graphics.cloudQuality,
      ),
    ),
    field(
      'Shadows',
      'Shadows of the vessel and the launch pad. Resolution of the shadow map.',
      bind(
        segmented<number>({
          label: 'Shadow quality',
          options: [{ value: 0, label: 'Off' }, { value: 1, label: 'Low' }, { value: 2, label: 'Medium' }, { value: 3, label: 'High' }],
          value: 2,
          onChange: (v) => g({ shadowQuality: v as GraphicsSettings['shadowQuality'] }),
        }),
        (s) => s.graphics.shadowQuality,
      ),
    ),
    field(
      'Effects density',
      'Smoke, exhaust and plasma particles.',
      bind(slider({ label: 'Effects density', min: 0.1, max: 1, step: 0.05, value: 1, format: pct, onInput: (v) => g({ particleScale: v }) }), (s) => Math.min(1, s.graphics.particleScale)),
    ),
    field(
      'Bloom',
      'Glow around bright lights and the sun.',
      bind(toggle({ label: 'Bloom', value: true, onChange: (v) => g({ bloom: v }) }), (s) => s.graphics.bloom),
    ),
    field(
      'Anti-aliasing',
      'Smooths jagged edges (4× MSAA).',
      bind(toggle({ label: 'Anti-aliasing', value: true, onChange: (v) => g({ antialiasing: v }) }), (s) => s.graphics.antialiasing),
    ),
    sectionTitle('Display'),
    field(
      'Field of view',
      'Vertical, in degrees.',
      bind(
        slider({ label: 'Field of view', min: 40, max: 100, step: 1, value: 55, format: (v) => `${v}°`, onInput: (v) => g({ fov: v }) }),
        (s) => s.graphics.fov,
      ),
    ),
    field(
      'Frame limit',
      'Display uses your monitor refresh rate.',
      bind(
        segmented<number>({
          label: 'Frame limit',
          options: [
            { value: 0, label: 'Display' },
            { value: 30, label: '30' },
            { value: 60, label: '60' },
            { value: 120, label: '120' },
          ],
          value: 0,
          onChange: (v) => g({ frameCap: v as GraphicsSettings['frameCap'] }),
        }),
        (s) => s.graphics.frameCap,
      ),
    ),
    field(
      'Renderer',
      `Currently running on ${gfx.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2'}. Auto prefers WebGPU; WebGL 2 is the compatibility path.`,
      h(
        'div',
        { style: 'display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;justify-content:flex-end' },
        reloadBtn,
        bind(
          segmented<'auto' | 'webgl2'>({
            label: 'Rendering backend',
            options: [
              { value: 'auto', label: 'Auto' },
              { value: 'webgl2', label: 'WebGL 2' },
            ],
            value: 'auto',
            onChange: (v) => g({ backend: v }),
          }),
          (s) => s.graphics.backend,
        ),
      ),
    ),
  );

  // ---- Audio ----
  const audioSlider = (label: string, key: keyof Settings['audio'], hint: string) =>
    field(
      label,
      hint,
      bind(
        slider({ label, min: 0, max: 1, step: 0.01, value: 1, format: pct, onInput: (v) => settings.patch('audio', { [key]: v }) }),
        (s) => s.audio[key],
      ),
    );
  const audio = panel(
    sectionTitle('Volume'),
    audioSlider('Master', 'master', 'Overall output level.'),
    audioSlider('Effects', 'effects', 'Engines, staging, impacts.'),
    audioSlider('Ambience', 'ambience', 'Wind, rumble, atmosphere.'),
    audioSlider('Music', 'music', 'Background music.'),
    h('p', { class: 'field-hint', text: 'Every sound is generated as you play: engines, wind, interface and music. Nothing is downloaded.' }),
  );

  // ---- Controls ----
  const controls = buildControlsPanel(settings, bind, syncers);

  // ---- Gameplay ----
  const gameplay = panel(
    sectionTitle('Units & hints'),
    field(
      'Units',
      'How distances and speeds are shown.',
      bind(
        segmented<'metric' | 'imperial'>({
          label: 'Units',
          options: [
            { value: 'metric', label: 'Metric' },
            { value: 'imperial', label: 'Imperial' },
          ],
          value: 'metric',
          onChange: (v) => settings.patch('gameplay', { units: v }),
        }),
        (s) => s.gameplay.units,
      ),
    ),
    field('Hints', 'Short tips that appear the first time something comes up.', bind(toggle({ label: 'Hints', value: true, onChange: (v) => settings.patch('gameplay', { hints: v }) }), (s) => s.gameplay.hints)),
    field('Show hints again', 'Forget which hints you have already seen.', button({ label: 'Reset hints', variant: 'quiet', onClick: () => { try { localStorage.removeItem(HINTS_KEY); } catch { /* storage blocked */ } dispatchEvent(new Event(RESET_HINTS_EVENT)); } })),
    field('Tooltips', 'Short explanations when hovering controls.', bind(toggle({ label: 'Tooltips', value: true, onChange: (v) => settings.patch('gameplay', { tooltips: v }) }), (s) => s.gameplay.tooltips)),
    sectionTitle('Flight'),
    field('SAS on at launch', 'Start with stability assist enabled.', bind(toggle({ label: 'SAS on at launch', value: true, onChange: (v) => settings.patch('gameplay', { sasDefault: v }) }), (s) => s.gameplay.sasDefault)),
    field('Auto-warp safety', 'Limit time warp near the atmosphere and surfaces.', bind(toggle({ label: 'Auto-warp safety', value: true, onChange: (v) => settings.patch('gameplay', { autoWarpSafety: v }) }), (s) => s.gameplay.autoWarpSafety)),
  );

  // ---- Interface ----
  const iface = panel(
    sectionTitle('Layout'),
    field(
      'UI scale',
      'Scales every panel and readout.',
      bind(
        slider({ label: 'UI scale', min: 0.8, max: 1.6, step: 0.05, value: 1, format: pct, onInput: (v) => settings.patch('interface', { uiScale: v }) }),
        (s) => s.interface.uiScale,
      ),
    ),
    field(
      'HUD opacity',
      'Transparency of flight readouts.',
      bind(
        slider({ label: 'HUD opacity', min: 0.3, max: 1, step: 0.05, value: 1, format: pct, onInput: (v) => settings.patch('interface', { hudOpacity: v }) }),
        (s) => s.interface.hudOpacity,
      ),
    ),
  );

  const content = tabs([
    { id: 'graphics', label: 'Graphics', content: graphics },
    { id: 'audio', label: 'Audio', content: audio },
    { id: 'controls', label: 'Controls', content: controls },
    { id: 'gameplay', label: 'Gameplay', content: gameplay },
    { id: 'interface', label: 'Interface', content: iface },
  ]);

  const sync = (s: Settings) => syncers.forEach((fn) => fn(s));
  sync(settings.get());
  const unsubscribe = settings.subscribe(sync);

  const modal = openModal({
    title: 'Settings',
    size: 'lg',
    content,
    footer: h(
      'div',
      { style: 'display:flex;justify-content:space-between;width:100%' },
      button({ label: 'Reset to defaults', variant: 'quiet', onClick: () => settings.reset() }),
      button({ label: 'Done', variant: 'primary', onClick: () => modal.close() }),
    ),
    onClose: () => {
      unsubscribe();
      settings.flush();
    },
  });
  return modal;
}

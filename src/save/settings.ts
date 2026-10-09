import { DEFAULT_BINDINGS, sanitize, type Bindings } from '../core/keymap';
import { Store } from '../core/store';
import { QUALITY_PRESETS, type QualityPresetId, type QualityValues } from '../data/quality';

export const SETTINGS_VERSION = 2;
export const SETTINGS_KEY = 'orbital.settings';

export interface GraphicsSettings extends QualityValues {
  preset: QualityPresetId | 'custom';
  fov: number; // vertical degrees
  frameCap: 0 | 30 | 60 | 120 | 144; // 0 = display refresh
  backend: 'auto' | 'webgl2'; // 'webgl2' forces the compatibility renderer (needs reload)
}

export interface Settings {
  version: number;
  graphics: GraphicsSettings;
  audio: { master: number; effects: number; ambience: number; music: number };
  controls: { mouseSensitivity: number; invertY: boolean; gamepad: boolean; gamepadDeadzone: number; bindings: Bindings };
  gameplay: { units: 'metric' | 'imperial'; tooltips: boolean; hints: boolean; guide: boolean; sasDefault: boolean; autoWarpSafety: boolean };
  interface: { uiScale: number; hudOpacity: number };
}

export const DEFAULT_PRESET: QualityPresetId = 'high';

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  graphics: { preset: DEFAULT_PRESET, ...QUALITY_PRESETS[DEFAULT_PRESET], fov: 55, frameCap: 0, backend: 'auto' },
  audio: { master: 0.8, effects: 1, ambience: 0.8, music: 0.6 },
  controls: { mouseSensitivity: 1, invertY: false, gamepad: true, gamepadDeadzone: 0.12, bindings: { ...DEFAULT_BINDINGS } },
  gameplay: { units: 'metric', tooltips: true, hints: true, guide: true, sasDefault: true, autoWarpSafety: true },
  interface: { uiScale: 1, hudOpacity: 1 },
};

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Overlay `saved` onto `base`, keeping only keys that exist in `base` with the same primitive type. */
function overlay<T extends object>(base: T, saved: unknown): T {
  if (!isObject(saved)) return structuredClone(base);
  const out: Json = {};
  for (const key of Object.keys(base)) {
    const b = (base as Json)[key];
    const s = saved[key];
    if (isObject(b)) out[key] = overlay(b, s);
    else out[key] = s !== undefined && typeof b === typeof s ? s : b;
  }
  return out as T;
}

/**
 * Upgrade any stored settings blob to the current schema.
 * When the shape changes, bump SETTINGS_VERSION and rewrite old fields here before the overlay;
 * unknown/corrupt input falls back to defaults field-by-field.
 */
export function migrateSettings(raw: unknown): Settings {
  const merged = overlay(DEFAULT_SETTINGS, raw);
  merged.version = SETTINGS_VERSION;
  merged.controls.bindings = sanitize(merged.controls.bindings);
  return merged;
}

/** Returns the preset id whose values equal the graphics options, otherwise "custom". */
export function matchPreset(g: GraphicsSettings): QualityPresetId | 'custom' {
  for (const [id, values] of Object.entries(QUALITY_PRESETS) as [QualityPresetId, QualityValues][]) {
    if ((Object.keys(values) as (keyof QualityValues)[]).every((k) => g[k] === values[k])) return id;
  }
  return 'custom';
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function safeLocalStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // access can throw when site data is blocked
  }
}

/** Settings persisted to localStorage (debounced; flushed when the page is hidden). */
export class SettingsStore extends Store<Settings> {
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private storage: StorageLike | null = safeLocalStorage()) {
    super(SettingsStore.load(storage));
  }

  private static load(storage: Pick<Storage, 'getItem'> | null): Settings {
    try {
      const text = storage?.getItem(SETTINGS_KEY);
      return migrateSettings(text ? JSON.parse(text) : null);
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  /** Change individual graphics options; the preset label follows along (or becomes "custom"). */
  setGraphics(patch: Partial<GraphicsSettings>): void {
    this.update((s) => {
      const graphics = { ...s.graphics, ...patch };
      if (!('preset' in patch)) graphics.preset = matchPreset(graphics);
      return { ...s, graphics };
    });
  }

  applyPreset(id: QualityPresetId): void {
    this.update((s) => ({ ...s, graphics: { ...s.graphics, ...QUALITY_PRESETS[id], preset: id } }));
  }

  patch<K extends 'audio' | 'controls' | 'gameplay' | 'interface'>(section: K, patch: Partial<Settings[K]>): void {
    this.update((s) => ({ ...s, [section]: { ...s[section], ...patch } }));
  }

  reset(): void {
    this.set(structuredClone(DEFAULT_SETTINGS));
  }

  override set(next: Settings): void {
    super.set(next);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 150);
  }

  /** Write immediately. */
  flush(): void {
    clearTimeout(this.saveTimer);
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(this.state));
    } catch {
      /* storage may be full or blocked; settings simply won't persist */
    }
  }
}

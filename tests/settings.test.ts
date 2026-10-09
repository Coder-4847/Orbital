import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from '../src/data/quality';
import { DEFAULT_SETTINGS, SETTINGS_KEY, SETTINGS_VERSION, SettingsStore, matchPreset, migrateSettings } from '../src/save/settings';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('migrateSettings', () => {
  it('returns defaults for null, junk and wrong types', () => {
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings({ graphics: { fov: 'wide' } }).graphics.fov).toBe(DEFAULT_SETTINGS.graphics.fov);
  });

  it('keeps valid saved values and fills in fields added in newer versions', () => {
    const old = { version: 0, graphics: { fov: 70 }, audio: { master: 0.2 } };
    const s = migrateSettings(old);
    expect(s.graphics.fov).toBe(70);
    expect(s.audio.master).toBe(0.2);
    expect(s.audio.music).toBe(DEFAULT_SETTINGS.audio.music);
    expect(s.interface).toEqual(DEFAULT_SETTINGS.interface);
    expect(s.version).toBe(SETTINGS_VERSION);
  });

  it('drops unknown keys', () => {
    const s = migrateSettings({ legacyThing: 1, graphics: { bogus: true } }) as unknown as Record<string, unknown>;
    expect(s.legacyThing).toBeUndefined();
    expect((s.graphics as Record<string, unknown>).bogus).toBeUndefined();
  });

  it('does not share nested objects with the defaults', () => {
    const s = migrateSettings(null);
    s.graphics.fov = 99;
    expect(DEFAULT_SETTINGS.graphics.fov).not.toBe(99);
  });
});

describe('SettingsStore', () => {
  it('persists changes and restores them in a new store', () => {
    const storage = new MemoryStorage();
    const a = new SettingsStore(storage);
    a.patch('interface', { uiScale: 1.25 });
    a.setGraphics({ fov: 80 });
    a.flush();
    expect(storage.getItem(SETTINGS_KEY)).toContain('1.25');

    const b = new SettingsStore(storage);
    expect(b.get().interface.uiScale).toBe(1.25);
    expect(b.get().graphics.fov).toBe(80);
  });

  it('survives corrupt stored JSON', () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, '{not json');
    expect(new SettingsStore(storage).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('works with no storage at all', () => {
    const s = new SettingsStore(null);
    s.patch('audio', { master: 0.1 });
    expect(s.get().audio.master).toBe(0.1);
  });

  it('applies presets and tracks custom edits', () => {
    const s = new SettingsStore(null);
    s.applyPreset('low');
    expect(s.get().graphics.preset).toBe('low');
    expect(s.get().graphics.resolutionScale).toBe(QUALITY_PRESETS.low.resolutionScale);
    s.setGraphics({ bloom: true });
    expect(s.get().graphics.preset).toBe('custom');
    s.setGraphics({ bloom: false });
    expect(s.get().graphics.preset).toBe('low');
  });

  it('notifies subscribers with next and previous state', () => {
    const s = new SettingsStore(null);
    const seen: Array<[number, number]> = [];
    s.subscribe((next, prev) => seen.push([next.graphics.fov, prev.graphics.fov]));
    s.setGraphics({ fov: 60 });
    expect(seen).toEqual([[60, DEFAULT_SETTINGS.graphics.fov]]);
  });

  it('reset restores defaults', () => {
    const s = new SettingsStore(null);
    s.patch('gameplay', { units: 'imperial' });
    s.reset();
    expect(s.get()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('matchPreset', () => {
  it('recognises every preset', () => {
    for (const [id, values] of Object.entries(QUALITY_PRESETS)) {
      expect(matchPreset({ ...DEFAULT_SETTINGS.graphics, ...values })).toBe(id);
    }
  });
});

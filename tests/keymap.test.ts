import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_BINDINGS, conflicts, isBindable, keyLabel, lookup, normalizeCode, rebind, sanitize } from '../src/core/keymap';
import { CHEATS_KEY, CheatStore, LEGACY_UNLIMITED_KEY, MAX_THRUST_MULTIPLIER, parseCheats, toFlags } from '../src/save/cheats';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/save/settings';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('key bindings', () => {
  it('every action has a unique default key', () => {
    expect(ACTIONS.length).toBeGreaterThan(30);
    expect(conflicts(DEFAULT_BINDINGS)).toEqual([]);
    for (const a of ACTIONS) expect(DEFAULT_BINDINGS[a.id]).toBeTruthy();
  });

  it('rebinding a key that is in use swaps the two actions', () => {
    const next = rebind(DEFAULT_BINDINGS, 'stage', 'KeyT');
    expect(next.stage).toBe('KeyT');
    expect(next.sas).toBe('Space'); // the SAS toggle took the stage key
    expect(conflicts(next)).toEqual([]);
    const free = rebind(DEFAULT_BINDINGS, 'stage', 'KeyF');
    expect(free.stage).toBe('KeyF');
    expect(conflicts(free)).toEqual([]);
  });

  it('left and right Shift are the same key', () => {
    expect(normalizeCode('ShiftRight')).toBe('ShiftLeft');
    expect(lookup(DEFAULT_BINDINGS).get(normalizeCode('ShiftRight'))).toBe('throttleUp');
    expect(lookup(DEFAULT_BINDINGS).get('Space')).toBe('stage');
  });

  it('labels keys readably and refuses keys that would trap the player', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Comma')).toBe(',');
    expect(keyLabel('ShiftLeft')).toBe('Shift');
    expect(isBindable('F5')).toBe(true);
    expect(isBindable('F12')).toBe(false);
    expect(isBindable('')).toBe(false);
  });

  it('falls back to defaults for junk and for duplicated keys in a saved file', () => {
    expect(sanitize(undefined)).toEqual(DEFAULT_BINDINGS);
    expect(sanitize({ stage: 'KeyK', translateDown: 'KeyK' })).toEqual(DEFAULT_BINDINGS); // a duplicate: start over
    expect(sanitize({ stage: 'Enter' }).stage).toBe('Enter');
    expect(sanitize({ stage: 42 as unknown as string }).stage).toBe(DEFAULT_BINDINGS.stage);
  });

  it('bindings survive in settings and old settings files get the defaults', () => {
    const s = migrateSettings({ version: 1, controls: { mouseSensitivity: 2 } });
    expect(s.controls.mouseSensitivity).toBe(2);
    expect(s.controls.bindings).toEqual(DEFAULT_BINDINGS);
    expect(s.controls.gamepad).toBe(true);
    const custom = migrateSettings({ controls: { bindings: { stage: 'Enter' } } });
    expect(custom.controls.bindings.stage).toBe('Enter');
    expect(custom.controls.bindings.sas).toBe(DEFAULT_SETTINGS.controls.bindings.sas);
  });
});

describe('cheats', () => {
  it('are all off by default and persist, including the legacy unlimited-build key the Hangar reads', () => {
    const storage = new MemoryStorage();
    const a = new CheatStore(storage);
    expect(a.anyActive).toBe(false);
    a.setCheat('invulnerable', true);
    a.setCheat('unlimitedBuild', true);
    expect(storage.getItem(LEGACY_UNLIMITED_KEY)).toBe('1');
    const b = new CheatStore(storage);
    expect(b.get().invulnerable).toBe(true);
    expect(b.get().unlimitedBuild).toBe(true);
    expect(b.anyActive).toBe(true);
    b.reset();
    expect(storage.getItem(LEGACY_UNLIMITED_KEY)).toBe('0');
    expect(new CheatStore(storage).anyActive).toBe(false);
  });

  it('an old install that only has the Hangar key keeps its unlimited building', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_UNLIMITED_KEY, '1');
    expect(new CheatStore(storage).get().unlimitedBuild).toBe(true);
  });

  it('ignores junk in storage and turns switches into physics flags', () => {
    expect(parseCheats({ invulnerable: 'yes', bogus: true, noAero: true }).invulnerable).toBe(false);
    expect(parseCheats({ noAero: true }).noAero).toBe(true);
    const storage = new MemoryStorage();
    storage.setItem(CHEATS_KEY, '{not json');
    expect(new CheatStore(storage).anyActive).toBe(false);
    const store = new CheatStore(new MemoryStorage());
    expect(toFlags(store.get()).thrustMultiplier).toBe(1);
    store.setCheat('maxThrust', true);
    expect(toFlags(store.get()).thrustMultiplier).toBe(MAX_THRUST_MULTIPLIER);
  });
});

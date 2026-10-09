import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { SAVE_SCHEMA_VERSION, SaveRepository, migrateSave, type SaveRecord } from '../src/save/saves';

let counter = 0;
const repo = () => new SaveRepository(`test-${++counter}`);

const record = (over: Partial<SaveRecord> = {}): SaveRecord => ({
  id: crypto.randomUUID(),
  name: 'Test flight',
  kind: 'manual',
  schemaVersion: SAVE_SCHEMA_VERSION,
  createdAt: 1000,
  updatedAt: 2000,
  gameTime: 86400 * 365,
  data: { vessel: { fuel: 42 } },
  ...over,
});

describe('SaveRepository', () => {
  it('round-trips a save', async () => {
    const r = repo();
    const rec = record();
    await r.put(rec);
    expect(await r.get(rec.id)).toEqual(rec);
  });

  it('lists newest first without the heavy payload', async () => {
    const r = repo();
    await r.put(record({ id: 'a', updatedAt: 1 }));
    await r.put(record({ id: 'b', updatedAt: 3 }));
    await r.put(record({ id: 'c', updatedAt: 2 }));
    const list = await r.list();
    expect(list.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(list[0]).not.toHaveProperty('data');
    expect((await r.latest())?.id).toBe('b');
  });

  it('overwrites on put with the same id and deletes cleanly', async () => {
    const r = repo();
    await r.put(record({ id: 'x', name: 'one' }));
    await r.put(record({ id: 'x', name: 'two' }));
    expect((await r.list()).length).toBe(1);
    expect((await r.get('x'))?.name).toBe('two');
    await r.delete('x');
    expect(await r.get('x')).toBeUndefined();
    expect(await r.list()).toEqual([]);
  });

  it('exports and imports a save as a file', async () => {
    const a = repo();
    const rec = record({ name: 'Moon shot' });
    await a.put(rec);
    const text = await a.exportSave(rec.id);

    const b = repo();
    const imported = await b.importSave(text);
    expect(imported.name).toBe('Moon shot');
    expect(imported.id).not.toBe(rec.id);
    expect((await b.get(imported.id))?.data).toEqual(rec.data);
  });

  it('rejects files that are not Orbital saves', async () => {
    await expect(repo().importSave('{"hello":1}')).rejects.toThrow(/Not an Orbital save/);
  });
});

describe('migrateSave', () => {
  it('runs each migration step in order', () => {
    const steps = {
      1: (d: unknown) => ({ ...(d as object), a: 1 }),
      2: (d: unknown) => ({ ...(d as object), b: 2 }),
    };
    const out = migrateSave({ schemaVersion: 1, data: {} }, steps, 3);
    expect(out).toEqual({ schemaVersion: 3, data: { a: 1, b: 2 } });
  });

  it('refuses saves from the future', () => {
    expect(() => migrateSave({ schemaVersion: 99, data: {} })).toThrow(/newer version/);
  });

  it('fails loudly when a migration is missing', () => {
    expect(() => migrateSave({ schemaVersion: 1, data: {} }, {}, 2)).toThrow(/No migration/);
  });
});

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { CraftRepository, exportCraft, importCraft } from '../src/builder/craft-store';
import { EXAMPLES } from '../src/builder/examples';
import { computeStats } from '../src/builder/stats';

let counter = 0;
const repo = () => new CraftRepository(`craft-test-${++counter}`);

describe('CraftRepository', () => {
  it('saves, lists, reloads and deletes crafts; the reloaded craft has the same numbers', async () => {
    const r = repo();
    const craft = EXAMPLES[0]!.build();
    const id = await r.save(craft);
    const list = await r.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: craft.name, partCount: craft.parts.length });
    const back = (await r.get(id))!;
    expect(computeStats(back).dvVac).toBeCloseTo(computeStats(craft).dvVac, 6);
    expect(back.parts).toEqual(craft.parts);
    await r.delete(id);
    expect(await r.list()).toHaveLength(0);
    expect(await r.get(id)).toBeUndefined();
  });

  it('saving a craft with an existing name overwrites it, a new name makes a new entry', async () => {
    const r = repo();
    const a = EXAMPLES[0]!.build();
    await r.save(a);
    a.parts.pop();
    await r.save(a);
    expect(await r.list()).toHaveLength(1);
    expect((await r.list())[0]!.partCount).toBe(a.parts.length);
    await r.save({ ...EXAMPLES[1]!.build() });
    expect(await r.list()).toHaveLength(2);
  });

  it('exports readable JSON and imports it back, rejecting other files', () => {
    const craft = EXAMPLES[2]!.build();
    const text = exportCraft(craft);
    expect(text).toContain('"format": "orbital-craft"');
    expect(importCraft(text).parts).toEqual(craft.parts);
    expect(() => importCraft('{"hello":1}')).toThrow();
  });
});

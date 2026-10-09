import { openDb, promisify, transact } from '../save/db';
import { parseCraft, serializeCraft, type Craft } from './craft';

/** Light metadata for lists; the full craft JSON is stored alongside. */
export interface CraftSummary {
  id: string;
  name: string;
  updatedAt: number;
  partCount: number;
}

interface CraftRecord extends CraftSummary {
  data: string;
}

/** Craft files in IndexedDB (the `crafts` store). Craft JSON is versioned by the craft itself; see craft.ts parseCraft. */
export class CraftRepository {
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(private readonly dbName?: string) {}

  private db(): Promise<IDBDatabase> {
    return (this.dbPromise ??= openDb(this.dbName));
  }

  /** Newest first. */
  async list(): Promise<CraftSummary[]> {
    const db = await this.db();
    const all = (await transact(db, ['crafts'], 'readonly', (open) => promisify(open('crafts').getAll()))) as CraftRecord[];
    return all.map(({ data: _data, ...summary }) => summary).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Craft | undefined> {
    const db = await this.db();
    const rec = (await transact(db, ['crafts'], 'readonly', (open) => promisify(open('crafts').get(id)))) as CraftRecord | undefined;
    return rec ? parseCraft(rec.data) : undefined;
  }

  /** Save under the craft's name: saving a name that already exists overwrites it. Returns the record id. */
  async save(craft: Craft, id?: string): Promise<string> {
    const existing = id ?? (await this.list()).find((s) => s.name === craft.name)?.id ?? crypto.randomUUID();
    const rec: CraftRecord = { id: existing, name: craft.name, updatedAt: Date.now(), partCount: craft.parts.length, data: serializeCraft(craft) };
    const db = await this.db();
    await transact(db, ['crafts'], 'readwrite', (open) => promisify(open('crafts').put(rec)));
    return existing;
  }

  async delete(id: string): Promise<void> {
    const db = await this.db();
    await transact(db, ['crafts'], 'readwrite', (open) => promisify(open('crafts').delete(id)));
  }
}

/** Portable text for sharing a craft. */
export const exportCraft = (c: Craft): string => JSON.stringify(JSON.parse(serializeCraft(c)), null, 2);

export const importCraft = (text: string): Craft => parseCraft(text);

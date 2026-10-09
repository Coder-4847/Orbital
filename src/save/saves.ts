import { openDb, promisify, transact } from './db';

/** Bump when the shape of `SaveRecord.data` changes, and add a step to MIGRATIONS. */
export const SAVE_SCHEMA_VERSION = 1;

export type SaveKind = 'manual' | 'auto' | 'quick';

/** Light metadata shown in lists. */
export interface SaveSummary {
  id: string;
  name: string;
  kind: SaveKind;
  schemaVersion: number;
  createdAt: number; // epoch ms (real time)
  updatedAt: number; // epoch ms = "last played"
  gameTime: number; // universal time, seconds since J2000
  thumbnail?: string; // small JPEG data URL
}

export interface SaveRecord extends SaveSummary {
  /** Full game state; opaque to the storage layer and defined by later phases. */
  data: unknown;
}

/** MIGRATIONS[n] upgrades data from schema n to n+1. */
const MIGRATIONS: Record<number, (data: unknown) => unknown> = {};

export function migrateSave<T extends { schemaVersion: number; data: unknown }>(rec: T, migrations = MIGRATIONS, target = SAVE_SCHEMA_VERSION): T {
  if (rec.schemaVersion > target) {
    throw new Error(`Save was made by a newer version of Orbital (schema ${rec.schemaVersion}).`);
  }
  let { schemaVersion, data } = rec;
  while (schemaVersion < target) {
    const step = migrations[schemaVersion];
    if (!step) throw new Error(`No migration from save schema ${schemaVersion}.`);
    data = step(data);
    schemaVersion++;
  }
  return { ...rec, schemaVersion, data };
}

const splitRecord = ({ data, ...summary }: SaveRecord) => ({ summary: summary as SaveSummary, data });

export class SaveRepository {
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(private dbName?: string) {}

  private db(): Promise<IDBDatabase> {
    return (this.dbPromise ??= openDb(this.dbName));
  }

  /** Newest first. */
  async list(): Promise<SaveSummary[]> {
    const db = await this.db();
    const all = await transact(db, ['saves'], 'readonly', (open) => promisify(open('saves').getAll()));
    return (all as SaveSummary[]).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<SaveRecord | undefined> {
    const db = await this.db();
    const [summary, payload] = await transact(db, ['saves', 'saveData'], 'readonly', async (open) => [
      await promisify(open('saves').get(id)),
      await promisify(open('saveData').get(id)),
    ]);
    if (!summary || !payload) return undefined;
    return migrateSave({ ...(summary as SaveSummary), data: (payload as { data: unknown }).data });
  }

  async put(rec: SaveRecord): Promise<void> {
    const db = await this.db();
    const { summary, data } = splitRecord(rec);
    await transact(db, ['saves', 'saveData'], 'readwrite', async (open) => {
      await promisify(open('saves').put(summary));
      await promisify(open('saveData').put({ id: rec.id, data }));
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.db();
    await transact(db, ['saves', 'saveData'], 'readwrite', async (open) => {
      await promisify(open('saves').delete(id));
      await promisify(open('saveData').delete(id));
    });
  }

  async latest(): Promise<SaveSummary | undefined> {
    return (await this.list())[0];
  }

  /** Portable file format for backups and sharing. */
  async exportSave(id: string): Promise<string> {
    const rec = await this.get(id);
    if (!rec) throw new Error('Save not found');
    return JSON.stringify({ format: 'orbital-save', ...rec });
  }

  async importSave(text: string): Promise<SaveSummary> {
    const parsed = JSON.parse(text) as Partial<SaveRecord> & { format?: string };
    if (parsed.format !== 'orbital-save' || typeof parsed.name !== 'string' || typeof parsed.schemaVersion !== 'number') {
      throw new Error('Not an Orbital save file.');
    }
    const now = Date.now();
    const rec = migrateSave({
      id: crypto.randomUUID(),
      name: parsed.name,
      kind: 'manual' as SaveKind,
      schemaVersion: parsed.schemaVersion,
      createdAt: parsed.createdAt ?? now,
      updatedAt: now,
      gameTime: parsed.gameTime ?? 0,
      thumbnail: parsed.thumbnail,
      data: parsed.data,
    });
    await this.put(rec);
    return splitRecord(rec).summary;
  }
}

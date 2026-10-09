/** Thin promise wrapper over IndexedDB. One database, several object stores. */

export const DB_NAME = 'orbital';
export const DB_VERSION = 1;

/** `saves` holds light metadata (cheap to list); `saveData` holds the heavy payload under the same id. */
export const STORES = ['saves', 'saveData', 'crafts', 'meta'] as const;
export type StoreName = (typeof STORES)[number];

export function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Future schema changes: branch on event.oldVersion and add stores/indexes incrementally.
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: store === 'meta' ? 'key' : 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  });
}

export const promisify = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** Run `fn` inside one transaction over `stores`; resolves with fn's result once the transaction commits. */
export function transact<T>(
  db: IDBDatabase,
  stores: StoreName[],
  mode: IDBTransactionMode,
  fn: (open: (name: StoreName) => IDBObjectStore) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    fn((name) => tx.objectStore(name)).then((r) => (result = r), reject);
  });
}

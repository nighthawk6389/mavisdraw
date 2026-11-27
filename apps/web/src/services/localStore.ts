/**
 * Minimal IndexedDB key-value store for data that must survive closing the
 * tab (unsaved edits). Falls back to memory where IndexedDB isn't available
 * (private modes that block it, tests), so callers never have to care.
 */
const DB_NAME = 'mavisdraw';
const STORE = 'kv';
const memory = new Map<string, unknown>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return memory.get(key) as T | undefined;
  return run<T>('readonly', (store) => store.get(key) as IDBRequest<T>);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory.set(key, value);
    return;
  }
  await run('readwrite', (store) => store.put(value, key));
}

export async function kvDelete(key: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory.delete(key);
    return;
  }
  await run('readwrite', (store) => store.delete(key));
}

/** Every key that starts with `prefix`. */
export async function kvKeys(prefix: string): Promise<string[]> {
  const db = await openDb();
  if (!db) return Array.from(memory.keys()).filter((k) => k.startsWith(prefix));
  const keys = await run<IDBValidKey[]>('readonly', (store) =>
    store.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)),
  );
  return (keys ?? []).filter((k): k is string => typeof k === 'string');
}

import { openDB, type IDBPDatabase } from 'idb';
import type { VersionSnapshot } from '@mavisdraw/types';

const DB_NAME = 'mavisdraw-versions';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';

interface MavisDrawVersionDB {
  snapshots: {
    key: string;
    value: VersionSnapshot;
    indexes: {
      'by-project': string;
      'by-date': number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<MavisDrawVersionDB>> | null = null;

export function getVersionDb(): Promise<IDBPDatabase<MavisDrawVersionDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MavisDrawVersionDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('by-project', 'projectId');
        store.createIndex('by-date', 'createdAt');
      },
    });
  }
  return dbPromise;
}

export async function saveSnapshot(snapshot: VersionSnapshot): Promise<void> {
  const db = await getVersionDb();
  await db.put(STORE_NAME, snapshot);
}

export async function getSnapshotsByProject(
  projectId: string,
): Promise<VersionSnapshot[]> {
  const db = await getVersionDb();
  const all = await db.getAllFromIndex(STORE_NAME, 'by-project', projectId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSnapshot(
  id: string,
): Promise<VersionSnapshot | undefined> {
  const db = await getVersionDb();
  return db.get(STORE_NAME, id);
}

export async function deleteSnapshotById(id: string): Promise<void> {
  const db = await getVersionDb();
  await db.delete(STORE_NAME, id);
}

/**
 * Delete auto-save snapshots older than maxAge (ms) or exceeding maxCount.
 * Manually-labeled snapshots are preserved regardless of age.
 */
export async function pruneSnapshots(
  projectId: string,
  maxAge: number,
  maxCount: number,
): Promise<number> {
  const db = await getVersionDb();
  const all = await db.getAllFromIndex(STORE_NAME, 'by-project', projectId);

  // Separate auto-saves from manual saves
  const autoSaves = all
    .filter((s) => s.isAutoSave)
    .sort((a, b) => b.createdAt - a.createdAt);

  const now = Date.now();
  let pruned = 0;

  for (let i = 0; i < autoSaves.length; i++) {
    const snapshot = autoSaves[i];
    const isOld = now - snapshot.createdAt > maxAge;
    const isOverCount = i >= maxCount;

    if (isOld || isOverCount) {
      await db.delete(STORE_NAME, snapshot.id);
      pruned++;
    }
  }

  return pruned;
}

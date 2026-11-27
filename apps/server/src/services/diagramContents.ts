import * as Y from 'yjs';
import { eq } from 'drizzle-orm';
import type { Document, Hocuspocus } from '@hocuspocus/server';
import { db } from '../db/client.js';
import { diagrams } from '../db/schema.js';
import { documentNameFor } from '../ws/hocuspocus.js';
import {
  applyState,
  encodeState,
  readLiveElements,
  seedElements,
  type ElementJSON,
} from '../ws/ydocElements.js';
import { withDiagramLock } from './diagramLock.js';

/**
 * Changing a diagram's elements from outside the live room (a REST save, a
 * version restore, a rename) without losing anyone else's write.
 */

/** The collaboration server's rooms (the debouncer is optional for tests). */
export type Rooms = Pick<Hocuspocus, 'documents' | 'loadingDocuments'> & {
  debouncer?: Pick<Hocuspocus['debouncer'], 'isDebounced' | 'executeNow'>;
};

const storeKey = (name: string) => `onStoreDocument-${name}`;

/**
 * The open room for a diagram, waiting for one that's still loading
 * (reading or changing a half-loaded, empty document would lose data).
 */
export async function openRoom(rooms: Rooms, diagramId: string): Promise<Document | undefined> {
  const name = documentNameFor(diagramId);
  const loading = rooms.loadingDocuments.get(name);
  if (loading) {
    try {
      return await loading;
    } catch {
      return undefined;
    }
  }
  return rooms.documents.get(name);
}

/** A room is open or opening, or closed with its last save still to run. */
function roomActive(rooms: Rooms, name: string): boolean {
  return (
    rooms.documents.has(name) ||
    rooms.loadingDocuments.has(name) ||
    rooms.debouncer?.isDebounced(storeKey(name)) === true
  );
}

const RETRY = Symbol('retry');
const MAX_ATTEMPTS = 10;

export interface ElementsChanged<T> {
  result: T;
  /** The room it was made in, or null if it went into the stored state. */
  live: Document | null;
}

/**
 * Change a diagram's elements wherever they are now:
 * - in its live room, if one is open: everyone sees the change at once, and
 *   the room saves it;
 * - otherwise in the stored CRDT state, so that deletions become tombstones
 *   a tab with an old copy can't undo. This holds the diagram's lock (a room
 *   opening meanwhile waits, then loads the state after the change) and the
 *   row's lock (two saves can't both start from the same old state).
 *
 * `change` runs once, synchronously, on a loaded document. Returns null if
 * the diagram doesn't exist.
 */
export async function changeDiagramElements<T>(
  rooms: Rooms,
  diagramId: string,
  change: (doc: Y.Doc) => T,
): Promise<ElementsChanged<T> | null> {
  const name = documentNameFor(diagramId);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const live = await openRoom(rooms, diagramId);
    if (live) return { result: change(live), live };
    if (rooms.debouncer?.isDebounced(storeKey(name))) {
      // A room just closed with its last edits unsaved: save them first
      await rooms.debouncer.executeNow(storeKey(name));
      continue;
    }
    const outcome = await withDiagramLock(diagramId, async () => {
      if (roomActive(rooms, name)) return RETRY;
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ elements: diagrams.elements, yjsState: diagrams.yjsState })
          .from(diagrams)
          .where(eq(diagrams.id, diagramId))
          .for('update');
        if (!row) return null;
        const doc = new Y.Doc();
        if (row.yjsState) applyState(doc, row.yjsState);
        else seedElements(doc, (row.elements ?? []) as ElementJSON[]);
        const before = Y.encodeStateVector(doc);
        const result = change(doc);
        if (!sameBytes(before, Y.encodeStateVector(doc))) {
          await tx
            .update(diagrams)
            .set({
              elements: readLiveElements(doc),
              yjsState: encodeState(doc),
              updatedAt: new Date(),
            })
            .where(eq(diagrams.id, diagramId));
        }
        return { result, live: null };
      });
    });
    if (outcome !== RETRY) return outcome;
  }
  throw new Error(`Diagram ${diagramId} kept opening and closing while being saved`);
}

/**
 * Write a diagram's stored contents directly (a whole-diagram replace from
 * an API client), under the same locks, but only while no room is open:
 * returns false if one is, for the caller to write into it instead.
 */
export async function replaceStoredElements(
  rooms: Rooms,
  diagramId: string,
  elements: unknown[],
): Promise<boolean> {
  const name = documentNameFor(diagramId);
  if (rooms.debouncer?.isDebounced(storeKey(name))) {
    await rooms.debouncer.executeNow(storeKey(name));
  }
  return withDiagramLock(diagramId, async () => {
    if (roomActive(rooms, name)) return false;
    await db.transaction(async (tx) => {
      await tx
        .select({ id: diagrams.id })
        .from(diagrams)
        .where(eq(diagrams.id, diagramId))
        .for('update');
      // The stored CRDT state no longer matches: the next room re-seeds
      await tx
        .update(diagrams)
        .set({ elements, yjsState: null, updatedAt: new Date() })
        .where(eq(diagrams.id, diagramId));
    });
    return true;
  });
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import type { Document } from '@hocuspocus/server';
import { withDiagramLock, isDiagramLocked } from '../services/diagramLock.js';
import {
  encodeState,
  applyState,
  readElements,
  replaceElements,
  seedElements,
} from '../ws/ydocElements.js';

/** A stand-in for the diagrams table: one row per id, read and written in a transaction. */
const rows = new Map<string, { elements: unknown[]; yjsState: string | null }>();
const writes: Array<{ id: string; elements: unknown[]; yjsState: string | null }> = [];
/** How long reading the row takes (to catch a save in the middle). */
let readDelayMs = 0;

vi.mock('../db/client.js', () => {
  let current = '';
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => {
            if (readDelayMs) await new Promise((r) => setTimeout(r, readDelayMs));
            return rows.has(current) ? [rows.get(current)] : [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: { elements: unknown[]; yjsState: string | null }) => ({
        where: async () => {
          rows.set(current, { elements: values.elements, yjsState: values.yjsState });
          writes.push({ id: current, ...values });
        },
      }),
    }),
  };
  return {
    db: {
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      /** Tests say which row the next transaction is about. */
      __use: (id: string) => (current = id),
    },
  };
});

const { db } = (await import('../db/client.js')) as unknown as {
  db: { __use: (id: string) => void };
};
const { changeDiagramElements, openRoom } = await import('../services/diagramContents.js');

const el = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'rectangle',
  x: 0,
  version: 1,
  isDeleted: false,
  ...extra,
});

function rooms(
  over: Partial<{
    documents: Map<string, Document>;
    loadingDocuments: Map<string, Promise<Document>>;
    pending: Set<string>;
    onFlush: (key: string) => void;
  }> = {},
) {
  const pending = over.pending ?? new Set<string>();
  return {
    documents: over.documents ?? new Map(),
    loadingDocuments: over.loadingDocuments ?? new Map(),
    debouncer: {
      isDebounced: (key: string) => pending.has(key),
      executeNow: vi.fn(async (key: string) => {
        pending.delete(key);
        over.onFlush?.(key);
      }),
    },
  };
}

beforeEach(() => {
  rows.clear();
  writes.length = 0;
  readDelayMs = 0;
});

describe('withDiagramLock', () => {
  it('runs one at a time per diagram, in order, and lets other diagrams through', async () => {
    const log: string[] = [];
    const step = (name: string, ms: number) => async () => {
      log.push(`${name} start`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`${name} end`);
    };
    await Promise.all([
      withDiagramLock('d1', step('a', 20)),
      withDiagramLock('d1', step('b', 1)),
      withDiagramLock('d2', step('other', 1)),
    ]);
    expect(log.indexOf('a end')).toBeLessThan(log.indexOf('b start'));
    expect(log.indexOf('other end')).toBeLessThan(log.indexOf('a end'));
    expect(isDiagramLocked('d1')).toBe(false);
  });

  it('a failure releases the lock for the next writer', async () => {
    await expect(
      withDiagramLock('d3', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(withDiagramLock('d3', async () => 'next')).resolves.toBe('next');
  });
});

describe('changeDiagramElements', () => {
  it('changes the live room when one is open (nothing written to the table)', async () => {
    const live = new Y.Doc() as unknown as Document;
    seedElements(live, [el('a')]);
    const r = rooms({ documents: new Map([['diagram:d', live]]) });
    const out = await changeDiagramElements(r, 'd', (doc) => {
      replaceElements(doc, []);
      return 'done';
    });
    expect(out).toEqual({ result: 'done', live });
    expect(readElements(live)[0].isDeleted).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it('waits for a room that is still loading rather than writing around it', async () => {
    const live = new Y.Doc() as unknown as Document;
    let loaded!: (d: Document) => void;
    const loading = new Promise<Document>((r) => (loaded = r));
    const r = rooms({ loadingDocuments: new Map([['diagram:d', loading]]) });
    const pending = changeDiagramElements(r, 'd', (doc) => seedElements(doc, [el('a')]));
    loaded(live);
    expect((await pending)?.live).toBe(live);
    expect(readElements(live).map((e) => e.id)).toEqual(['a']);
    expect(await openRoom(r, 'missing')).toBeUndefined();
  });

  it('with no room, changes the stored CRDT state, so deletions are kept as tombstones', async () => {
    const before = new Y.Doc();
    seedElements(before, [el('keep'), el('gone')]);
    rows.set('d', { elements: [], yjsState: encodeState(before) });
    db.__use('d');

    const out = await changeDiagramElements(rooms(), 'd', (doc) =>
      replaceElements(doc, [el('keep')]),
    );
    expect(out?.live).toBeNull();
    expect(writes).toHaveLength(1);
    expect(writes[0].elements.map((e) => (e as { id: string }).id)).toEqual(['keep']);
    // A tab holding the old state merges in: what the restore deleted stays deleted
    const stored = new Y.Doc();
    applyState(stored, writes[0].yjsState!);
    Y.applyUpdate(stored, Y.encodeStateAsUpdate(before));
    const gone = readElements(stored).find((e) => e.id === 'gone');
    expect(gone?.isDeleted).toBe(true);
  });

  it('seeds a diagram that has no CRDT state yet, and writes nothing when nothing changed', async () => {
    rows.set('d', { elements: [el('a')], yjsState: null });
    db.__use('d');
    const out = await changeDiagramElements(rooms(), 'd', (doc) => readElements(doc).length);
    expect(out?.result).toBe(1);
    expect(writes).toHaveLength(0);
  });

  it('saves a closed room’s last edits first, then changes what it saved', async () => {
    db.__use('d');
    const closed = new Y.Doc();
    seedElements(closed, [el('late')]);
    const r = rooms({
      pending: new Set(['onStoreDocument-diagram:d']),
      // The room's pending save runs: the table gets its state
      onFlush: () => rows.set('d', { elements: [], yjsState: encodeState(closed) }),
    });
    const out = await changeDiagramElements(r, 'd', (doc) => {
      seedElements(doc, [el('mine')]);
      return readElements(doc)
        .map((e) => e.id)
        .sort();
    });
    expect(r.debouncer.executeNow).toHaveBeenCalledWith('onStoreDocument-diagram:d');
    expect(out?.result).toEqual(['late', 'mine']);
  });

  it('a diagram that does not exist is null', async () => {
    db.__use('nope');
    expect(await changeDiagramElements(rooms(), 'nope', () => 1)).toBeNull();
  });

  it('a room that opens while a save holds the lock loads what the save wrote', async () => {
    const before = new Y.Doc();
    seedElements(before, [el('a')]);
    rows.set('d', { elements: [], yjsState: encodeState(before) });
    db.__use('d');
    readDelayMs = 20;
    // The save starts first and holds the lock…
    const save = changeDiagramElements(rooms(), 'd', (doc) => seedElements(doc, [el('b')]));
    while (!isDiagramLocked('d')) await new Promise((r) => setTimeout(r, 0));
    // …a room opening now reads the row under the same lock, after the save
    const opened = withDiagramLock('d', async () => rows.get('d')!.yjsState!);
    await save;
    const doc = new Y.Doc();
    applyState(doc, await opened);
    expect(
      readElements(doc)
        .map((e) => e.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });
});

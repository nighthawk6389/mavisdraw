import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  writeElement,
  readElements,
  readLiveElements,
  seedElements,
  mergeElements,
  mergeElementList,
  replaceElements,
  encodeState,
  applyState,
} from '../ws/ydocElements.js';

const el = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  version: 1,
  isDeleted: false,
  ...extra,
});

function byId(doc: Y.Doc) {
  return Object.fromEntries(readElements(doc).map((e) => [e.id, e]));
}

describe('ydoc element helpers', () => {
  it('writes only changed properties so concurrent edits merge', () => {
    // Two replicas of the same element
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedElements(a, [el('s1')]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // Alice moves it, Bob recolours it — concurrently
    writeElement(a.getMap('elements'), el('s1', { x: 100, version: 2 }));
    writeElement(b.getMap('elements'), el('s1', { strokeColor: '#f00', version: 2 }));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    for (const doc of [a, b]) {
      expect(byId(doc).s1.x).toBe(100);
      expect(byId(doc).s1.strokeColor).toBe('#f00');
    }
  });

  it('merge from REST only applies newer versions', () => {
    const doc = new Y.Doc();
    seedElements(doc, [el('s1', { x: 50, version: 5 })]);
    const { written, conflicts } = mergeElements(doc, [
      el('s1', { x: 1, version: 3 }), // stale client: ignored
      el('s2', { version: 1 }), // new element: added
    ]);
    expect(written).toBe(1);
    expect(conflicts).toEqual(['s1']);
    expect(byId(doc).s1.x).toBe(50);
    expect(byId(doc).s2).toBeDefined();
  });

  it('merge never removes elements a REST client did not mention', () => {
    const doc = new Y.Doc();
    seedElements(doc, [el('s1'), el('s2')]);
    mergeElements(doc, [el('s1', { version: 2 })]);
    expect(Object.keys(byId(doc)).sort()).toEqual(['s1', 's2']);
  });

  it('restore replaces contents and wins over every live version', () => {
    const doc = new Y.Doc();
    seedElements(doc, [el('s1', { x: 9, version: 7 }), el('s2', { version: 3 })]);
    replaceElements(doc, [el('s1', { x: 1, version: 2 })]);
    const now = byId(doc);
    expect(now.s1.x).toBe(1);
    expect(now.s1.version).toBe(8);
    expect(now.s2.isDeleted).toBe(true);
  });

  it('with base versions, an edit applies only if nobody changed the element since', () => {
    const doc = new Y.Doc();
    seedElements(doc, [el('a', { x: 0, version: 50 }), el('b', { x: 0, version: 4 })]);
    // A teammate dragged "a" many times (v50); this client recoloured "a" from
    // an old copy (v5) and moved "b" from the current one (v4)
    const out = mergeElements(doc, {
      elements: [el('a', { strokeColor: 'red', version: 6 }), el('b', { x: 99, version: 5 })],
      baseVersions: { a: 5, b: 4 },
    });
    expect(out.conflicts).toEqual(['a']);
    expect(byId(doc).a.strokeColor).toBeUndefined();
    expect(byId(doc).b.x).toBe(99);
  });

  it('a high edit count from a stale tab no longer wins', () => {
    const doc = new Y.Doc();
    seedElements(doc, [el('a', { x: 10, width: 300, version: 20 })]);
    const out = mergeElements(doc, {
      elements: [el('a', { x: 500, version: 80 })], // dragged a lot, from a v3 copy
      baseVersions: { a: 3 },
    });
    expect(out.conflicts).toEqual(['a']);
    expect(byId(doc).a.x).toBe(10);
    expect(byId(doc).a.width).toBe(300);
  });

  it('unchanged elements are skipped (no version churn)', () => {
    const doc = new Y.Doc();
    seedElements(doc, [el('a', { version: 7 })]);
    const out = mergeElements(doc, { elements: [el('a', { version: 7 })], baseVersions: { a: 7 } });
    expect(out).toEqual({ written: 0, conflicts: [] });
    expect(byId(doc).a.version).toBe(7);
  });

  it('deletes become tombstones, unless a teammate edited the element since', () => {
    const doc = new Y.Doc();
    seedElements(doc, [el('a', { version: 3 }), el('b', { version: 9 })]);
    const out = mergeElements(doc, {
      elements: [],
      deletedIds: ['a', 'b', 'never-saved'],
      baseVersions: { a: 3, b: 2 },
    });
    expect(out.conflicts).toEqual(['b']);
    expect(byId(doc).a).toMatchObject({ isDeleted: true, version: 4 });
    expect(byId(doc).b.isDeleted).toBe(false);
  });

  it('a stale save never resurrects a deleted element', () => {
    const doc = new Y.Doc();
    seedElements(doc, [el('a', { version: 3 })]);
    mergeElements(doc, { elements: [], deletedIds: ['a'], baseVersions: { a: 3 } });
    const out = mergeElements(doc, {
      elements: [el('a', { x: 1, version: 4 })],
      baseVersions: { a: 3 },
    });
    expect(out.conflicts).toEqual(['a']);
    expect(byId(doc).a.isDeleted).toBe(true);
  });

  it('stored-list merge follows the same rules', () => {
    const out = mergeElementList([el('a', { version: 2 }), el('b', { version: 5 })], {
      elements: [el('a', { x: 7, version: 3 }), el('b', { x: 7, version: 3 }), el('c')],
      deletedIds: [],
      baseVersions: { a: 2, b: 1 },
    });
    expect(out.conflicts).toEqual(['b']);
    const ids = Object.fromEntries(out.elements.map((e) => [e.id, e]));
    expect(ids.a.x).toBe(7);
    expect(ids.b.x).toBe(0);
    expect(ids.c).toBeDefined();
  });

  it('live elements leave out soft-deleted ones', () => {
    const doc = new Y.Doc();
    seedElements(doc, [el('s1'), el('s2', { isDeleted: true })]);
    expect(readLiveElements(doc).map((e) => e.id)).toEqual(['s1']);
    expect(readElements(doc)).toHaveLength(2);
  });

  it('round-trips the CRDT state through base64', () => {
    const doc = new Y.Doc();
    seedElements(doc, [el('s1', { x: 42 })]);
    const copy = new Y.Doc();
    applyState(copy, encodeState(doc));
    expect(byId(copy).s1.x).toBe(42);
  });
});

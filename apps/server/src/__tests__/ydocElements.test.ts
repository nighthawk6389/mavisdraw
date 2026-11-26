import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  writeElement,
  readElements,
  readLiveElements,
  seedElements,
  mergeElements,
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
    const written = mergeElements(doc, [
      el('s1', { x: 1, version: 3 }), // stale client: ignored
      el('s2', { version: 1 }), // new element: added
    ]);
    expect(written).toBe(1);
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

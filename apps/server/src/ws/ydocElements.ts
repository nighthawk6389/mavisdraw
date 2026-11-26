import * as Y from 'yjs';

/**
 * Helpers for the shared Y.Doc layout used by collaboration:
 *   doc.getMap('elements'): elementId → Y.Map(property → JSON value)
 *
 * Elements are written property-by-property so concurrent edits to
 * different properties of the same element merge instead of overwriting
 * each other.
 */

export type ElementJSON = Record<string, unknown> & { id: string; version?: number };

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Write one element into the map, touching only properties that changed. */
export function writeElement(elements: Y.Map<unknown>, el: ElementJSON): void {
  const existing = elements.get(el.id);
  if (!(existing instanceof Y.Map)) {
    const map = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(el)) map.set(k, v);
    elements.set(el.id, map);
    return;
  }
  for (const [k, v] of Object.entries(el)) {
    if (!sameValue(existing.get(k), v)) existing.set(k, v);
  }
  for (const k of Array.from(existing.keys())) {
    if (!(k in el)) existing.delete(k);
  }
}

export function readElements(doc: Y.Doc): ElementJSON[] {
  const out: ElementJSON[] = [];
  doc.getMap('elements').forEach((value) => {
    if (value instanceof Y.Map) out.push(value.toJSON() as ElementJSON);
    else if (value && typeof value === 'object') out.push(value as ElementJSON);
  });
  return out;
}

/** Elements currently on the canvas (soft-deleted ones left out). */
export function readLiveElements(doc: Y.Doc): ElementJSON[] {
  return readElements(doc).filter((el) => el.isDeleted !== true);
}

export function seedElements(doc: Y.Doc, elements: ElementJSON[]): void {
  const map = doc.getMap('elements');
  doc.transact(() => {
    for (const el of elements) if (el && typeof el.id === 'string') writeElement(map, el);
  });
}

/**
 * Merge elements coming from a REST save into a live document: an element is
 * written only if it's new or has a higher version than what's live, so a
 * stale client can't roll back someone else's newer edit. Nothing is removed.
 */
export function mergeElements(
  doc: Y.Doc,
  elements: ElementJSON[],
  origin: unknown = 'rest',
): number {
  const map = doc.getMap('elements');
  let written = 0;
  doc.transact(() => {
    for (const el of elements) {
      if (!el || typeof el.id !== 'string') continue;
      const live = map.get(el.id);
      const liveVersion = live instanceof Y.Map ? Number(live.get('version') ?? 0) : -1;
      if (Number(el.version ?? 0) > liveVersion) {
        writeElement(map, el);
        written++;
      }
    }
  }, origin);
  return written;
}

/**
 * Replace the live contents with a snapshot (version restore): snapshot
 * elements come back with versions above anything live, everything else is
 * soft-deleted, so every connected client converges on the snapshot.
 */
export function replaceElements(
  doc: Y.Doc,
  elements: ElementJSON[],
  origin: unknown = 'restore',
): void {
  const map = doc.getMap('elements');
  const now = Date.now();
  const keep = new Set(elements.map((e) => e.id));
  let maxVersion = 0;
  map.forEach((value) => {
    if (value instanceof Y.Map)
      maxVersion = Math.max(maxVersion, Number(value.get('version') ?? 0));
  });
  doc.transact(() => {
    for (const el of elements) {
      writeElement(map, { ...el, version: maxVersion + 1, updatedAt: now });
    }
    map.forEach((value, id) => {
      if (keep.has(id) || !(value instanceof Y.Map)) return;
      if (value.get('isDeleted') === true) return;
      value.set('isDeleted', true);
      value.set('version', maxVersion + 1);
      value.set('updatedAt', now);
    });
  }, origin);
}

export function encodeState(doc: Y.Doc): string {
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
}

export function applyState(doc: Y.Doc, base64: string): void {
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(base64, 'base64')));
}

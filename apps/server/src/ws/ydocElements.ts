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

/** A save from a REST client (an editor tab not in the live room, or an API user). */
export interface RestWrite {
  elements: ElementJSON[];
  /**
   * Version of each element as this client last got it from the server —
   * the base its edits were made on. Lets the server tell "you changed it"
   * from "you have an old copy".
   */
  baseVersions?: Record<string, number>;
  /** Elements this client deleted since its base. */
  deletedIds?: string[];
}

export interface MergeOutcome {
  written: number;
  /** Elements not applied because someone else changed them after the client's base. */
  conflicts: string[];
}

type Decision = 'apply' | 'unchanged' | 'conflict';

/**
 * Should an incoming element overwrite what the server has?
 * - With a base: only if nobody changed it since (current version == base);
 *   an untouched element (incoming == base) is skipped.
 * - Without a base (legacy/API writers): new elements apply; existing ones
 *   only with a higher version.
 */
export function decideWrite(
  current: { version?: number } | undefined,
  incomingVersion: number,
  base: number | undefined,
): Decision {
  if (base !== undefined) {
    if (incomingVersion === base) return 'unchanged';
    // A copy older than the base it claims can't be an edit of that base:
    // the client is out of step, and writing would revert someone's work
    if (incomingVersion < base) return 'conflict';
    return current !== undefined && Number(current.version ?? 0) === base ? 'apply' : 'conflict';
  }
  if (current === undefined) return 'apply';
  const version = Number(current.version ?? 0);
  if (incomingVersion === version) return 'unchanged';
  return incomingVersion > version ? 'apply' : 'conflict';
}

/** Should a client's delete apply? Only if it saw the element and nobody changed it since. */
export function decideDelete(
  current: { version?: number; isDeleted?: unknown } | undefined,
  base: number | undefined,
): Decision {
  if (base === undefined || current === undefined || current.isDeleted === true) return 'unchanged';
  return Number(current.version ?? 0) === base ? 'apply' : 'conflict';
}

/**
 * Merge a REST save into a live document. Edits apply per property (only
 * what changed is written); deletes become tombstones so every replica
 * converges; anything a teammate changed after the client's base is left
 * alone and reported back as a conflict.
 */
export function mergeElements(
  doc: Y.Doc,
  input: ElementJSON[] | RestWrite,
  origin: unknown = 'rest',
): MergeOutcome {
  const write: RestWrite = Array.isArray(input) ? { elements: input } : input;
  const map = doc.getMap('elements');
  const conflicts: string[] = [];
  let written = 0;
  const now = Date.now();
  doc.transact(() => {
    for (const el of write.elements) {
      if (!el || typeof el.id !== 'string') continue;
      const live = map.get(el.id);
      const current = live instanceof Y.Map ? (live.toJSON() as ElementJSON) : undefined;
      const incoming = Number(el.version ?? 0);
      const decision = decideWrite(current, incoming, write.baseVersions?.[el.id]);
      if (decision === 'conflict') conflicts.push(el.id);
      if (decision !== 'apply') continue;
      const version = Math.max(incoming, Number(current?.version ?? 0) + 1);
      writeElement(map, { ...el, version });
      written++;
    }
    for (const id of write.deletedIds ?? []) {
      const live = map.get(id);
      const current = live instanceof Y.Map ? (live.toJSON() as ElementJSON) : undefined;
      const decision = decideDelete(current, write.baseVersions?.[id]);
      if (decision === 'conflict') conflicts.push(id);
      if (decision !== 'apply' || !(live instanceof Y.Map)) continue;
      live.set('isDeleted', true);
      live.set('version', Number(current!.version ?? 0) + 1);
      live.set('updatedAt', now);
      written++;
    }
  }, origin);
  return { written, conflicts };
}

/**
 * The same rules for a diagram with no live room: merge into the stored
 * element list (which holds only live elements, so a deleted element simply
 * isn't there and is never resurrected by a stale save).
 */
export function mergeElementList(
  current: ElementJSON[],
  write: RestWrite,
): MergeOutcome & { elements: ElementJSON[] } {
  const byId = new Map(current.map((el) => [el.id, el]));
  const conflicts: string[] = [];
  let written = 0;
  for (const el of write.elements) {
    if (!el || typeof el.id !== 'string') continue;
    const existing = byId.get(el.id);
    const incoming = Number(el.version ?? 0);
    const decision = decideWrite(existing, incoming, write.baseVersions?.[el.id]);
    if (decision === 'conflict') conflicts.push(el.id);
    if (decision !== 'apply') continue;
    byId.set(el.id, { ...el, version: Math.max(incoming, Number(existing?.version ?? 0) + 1) });
    written++;
  }
  for (const id of write.deletedIds ?? []) {
    const decision = decideDelete(byId.get(id), write.baseVersions?.[id]);
    if (decision === 'conflict') conflicts.push(id);
    if (decision !== 'apply') continue;
    byId.delete(id);
    written++;
  }
  return {
    elements: Array.from(byId.values()).filter((el) => el.isDeleted !== true),
    written,
    conflicts,
  };
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

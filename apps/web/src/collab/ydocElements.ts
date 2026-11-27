import * as Y from 'yjs';
import type { MavisElement } from '@mavisdraw/types';

/**
 * Client mirror of the server's Y.Doc element helpers
 * (apps/server/src/ws/ydocElements.ts): one Y.Map per element, written
 * property-by-property so concurrent edits to different properties merge.
 */

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function writeElement(elements: Y.Map<unknown>, el: MavisElement): void {
  const existing = elements.get(el.id);
  if (!(existing instanceof Y.Map)) {
    const map = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(el)) if (v !== undefined) map.set(k, v);
    elements.set(el.id, map);
    return;
  }
  const record = el as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined) continue;
    if (!sameValue(existing.get(k), v)) existing.set(k, v);
  }
  for (const k of Array.from(existing.keys())) {
    if (!(k in record) || record[k] === undefined) existing.delete(k);
  }
}

export function readElement(value: unknown): MavisElement | null {
  if (value instanceof Y.Map) return value.toJSON() as MavisElement;
  return null;
}

/** Version stored for an element in the doc, or -1 if absent. */
export function docVersion(elements: Y.Map<unknown>, id: string): number {
  const value = elements.get(id);
  return value instanceof Y.Map ? Number(value.get('version') ?? 0) : -1;
}

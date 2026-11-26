import type { MavisElement } from '@mavisdraw/types';

/**
 * Patch-based undo history.
 *
 * Each entry records, for every element the *local user* touched during one
 * gesture, its value before and after. Undo restores only those elements, so
 * edits made by collaborators (applied with recording suppressed) are never
 * reverted, and memory grows with what changed rather than with diagram size.
 */
export interface HistoryEntry {
  /** Value before the gesture; `undefined` means the element didn't exist. */
  before: Map<string, MavisElement | undefined>;
  /** Value after the gesture (kept current while the gesture is open). */
  after: Map<string, MavisElement | undefined>;
  /** Coalescing key: consecutive pushes with the same key share an entry. */
  key?: string;
  /** Last time this entry received a push (for coalescing windows). */
  time: number;
}

export const MAX_HISTORY = 100;
export const COALESCE_WINDOW_MS = 1000;

export function createEntry(key?: string, time = Date.now()): HistoryEntry {
  return { before: new Map(), after: new Map(), key, time };
}

/** Ids whose element reference differs between two element maps. */
export function diffElementMaps(
  prev: Map<string, MavisElement>,
  next: Map<string, MavisElement>,
): string[] {
  const changed: string[] = [];
  for (const [id, el] of next) {
    if (prev.get(id) !== el) changed.push(id);
  }
  for (const id of prev.keys()) {
    if (!next.has(id)) changed.push(id);
  }
  return changed;
}

/** Record one observed change into an entry. */
export function recordChange(
  entry: HistoryEntry,
  id: string,
  before: MavisElement | undefined,
  after: MavisElement | undefined,
): void {
  if (!entry.before.has(id)) entry.before.set(id, before);
  entry.after.set(id, after);
}

const IGNORED_KEYS = new Set(['version', 'updatedAt']);

/** Structural equality ignoring bookkeeping fields. */
export function sameElementContent(
  a: MavisElement | undefined,
  b: MavisElement | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (IGNORED_KEYS.has(key)) continue;
    const av = (a as unknown as Record<string, unknown>)[key];
    const bv = (b as unknown as Record<string, unknown>)[key];
    if (av === bv) continue;
    if (typeof av !== 'object' || typeof bv !== 'object' || av === null || bv === null) {
      return false;
    }
    if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
  }
  return true;
}

/** True when undoing the entry would not visibly change anything. */
export function isNoopEntry(entry: HistoryEntry): boolean {
  for (const [id, before] of entry.before) {
    if (!sameElementContent(before, entry.after.get(id))) return false;
  }
  return true;
}

/**
 * Write recorded values back into `next`. Restored elements get a version
 * higher than whatever is currently in the map so that collaborators and
 * autosave treat the restore as a new edit.
 */
export function applyValues(
  next: Map<string, MavisElement>,
  values: Map<string, MavisElement | undefined>,
): void {
  const now = Date.now();
  for (const [id, value] of values) {
    if (value === undefined) {
      next.delete(id);
      continue;
    }
    const current = next.get(id);
    const version = Math.max(current?.version ?? 0, value.version) + 1;
    next.set(id, { ...value, version, updatedAt: now } as MavisElement);
  }
}

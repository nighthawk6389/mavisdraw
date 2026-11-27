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
const diffs = new WeakMap<
  Map<string, MavisElement>,
  { prev: Map<string, MavisElement>; changed: readonly string[] }
>();

/**
 * Ids added, changed or removed between two element maps. Several
 * subscribers (undo history, the live room, the offline journal) need it
 * for the same update: it's worked out once per pair of maps (don't mutate
 * the result).
 */
export function diffElementMaps(
  prev: Map<string, MavisElement>,
  next: Map<string, MavisElement>,
): readonly string[] {
  const hit = diffs.get(next);
  if (hit && hit.prev === prev) return hit.changed;
  const changed: string[] = [];
  let added = 0;
  for (const [id, el] of next) {
    const before = prev.get(id);
    if (before === el) continue;
    changed.push(id);
    if (before === undefined && !prev.has(id)) added++;
  }
  // Something was removed only if next has fewer of prev's ids than prev
  if (next.size - added < prev.size) {
    for (const id of prev.keys()) {
      if (!next.has(id)) changed.push(id);
    }
  }
  diffs.set(next, { prev, changed });
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

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Write recorded values back into `next` (undo: target = before, expected =
 * after; redo: the reverse).
 *
 * It's a three-way apply per property: a property is restored only if it
 * still holds the value this user left it at. If a collaborator changed it
 * since (moved the shape you'd moved, renamed the label you'd edited),
 * their newer value is kept, so undo never silently reverts someone else's
 * work. Restored elements get a version higher than the current one so
 * collaborators and autosave treat the restore as a new edit.
 */
export function applyValues(
  next: Map<string, MavisElement>,
  target: Map<string, MavisElement | undefined>,
  expected: Map<string, MavisElement | undefined> = new Map(),
): void {
  const now = Date.now();
  for (const [id, value] of target) {
    const current = next.get(id);
    const mine = expected.get(id);

    // Undoing a creation (or redoing a discard) deletes the element. It's a
    // soft delete with a newer version, so collaborators (and any stale copy
    // of it elsewhere) see it as deleted rather than missing.
    if (value === undefined) {
      if (current && !current.isDeleted) {
        next.set(id, {
          ...current,
          isDeleted: true,
          version: current.version + 1,
          updatedAt: now,
        } as MavisElement);
      }
      continue;
    }
    // Bringing back an element that no longer exists (or was soft-deleted by
    // the undo of its creation), or a fast path when nothing else touched it
    // since: restore the whole recorded value
    if (current === undefined || mine === undefined || current === mine) {
      const version = Math.max(current?.version ?? 0, value.version) + 1;
      next.set(id, { ...value, version, updatedAt: now } as MavisElement);
      continue;
    }

    const cur = current as unknown as Record<string, unknown>;
    const from = mine as unknown as Record<string, unknown>;
    const to = value as unknown as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...cur };
    let changed = false;
    for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
      if (IGNORED_KEYS.has(key)) continue;
      // Only properties this step actually changed…
      if (sameValue(from[key], to[key])) continue;
      // …and only if nobody has changed them since
      if (!sameValue(cur[key], from[key])) continue;
      if (to[key] === undefined) delete merged[key];
      else merged[key] = to[key];
      changed = true;
    }
    if (!changed) continue;
    merged.version = current.version + 1;
    merged.updatedAt = now;
    next.set(id, merged as unknown as MavisElement);
  }
}

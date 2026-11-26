import { create } from 'zustand';
import type { MavisElement } from '@mavisdraw/types';
import { useElementsStore, isApplyingUnrecorded, withoutHistory } from '../stores/elementsStore';
import { sameElementContent } from '../stores/history';
import { savedVersions } from './saveTracker';
import { kvDelete, kvGet, kvSet } from './localStore';

/**
 * Unsaved-edit journal: every local edit the server hasn't acknowledged yet
 * is kept in IndexedDB, with the server version it was based on. Close the
 * tab (or lose the network, or crash) and the edits come back the next time
 * the project is opened — and are only re-applied if nobody changed those
 * elements in the meantime.
 */

export interface JournalEntry {
  diagramId: string;
  /** The element as this user left it (isDeleted for a deletion). */
  element: MavisElement;
  /** Server version when this user started editing it (undefined: new element). */
  base?: number;
}

interface StoredJournal {
  v: 1;
  entries: JournalEntry[];
}

/** For the UI: how many edits are only on this device right now. */
export const useJournalStore = create<{ pending: number }>(() => ({ pending: 0 }));

const keyFor = (projectId: string) => `journal:${projectId}`;

let projectId: string | null = null;
let entries = new Map<string, JournalEntry>();
let unsubscribe: (() => void) | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function publish(): void {
  useJournalStore.setState({ pending: entries.size });
}

function persistSoon(delay = 250): void {
  if (!projectId) return;
  const id = projectId;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void persistNow(id);
  }, delay);
}

async function persistNow(id: string): Promise<void> {
  if (entries.size === 0) await kvDelete(keyFor(id));
  else
    await kvSet(keyFor(id), {
      v: 1,
      entries: Array.from(entries.values()),
    } satisfies StoredJournal);
}

function flushOnHide(): void {
  if (document.visibilityState === 'hidden' && projectId) {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = null;
    void persistNow(projectId);
  }
}

/** Start journaling local edits in a project (after its contents have loaded). */
export function startJournal(id: string, restored: JournalEntry[] = []): void {
  stopJournal();
  projectId = id;
  entries = new Map(restored.map((e) => [e.element.id, e]));
  publish();
  persistSoon(0);

  unsubscribe = useElementsStore.subscribe((state, prev) => {
    if (state.elements === prev.elements || isApplyingUnrecorded()) return;
    let changed = false;
    for (const [elId, el] of state.elements) {
      if (prev.elements.get(elId) === el) continue;
      record(el);
      changed = true;
    }
    for (const [elId, el] of prev.elements) {
      if (state.elements.has(elId)) continue;
      record({ ...el, isDeleted: true } as MavisElement);
      changed = true;
    }
    if (changed) {
      publish();
      persistSoon();
    }
  });
  window.addEventListener('visibilitychange', flushOnHide);
  window.addEventListener('pagehide', flushOnHide);
}

function record(el: MavisElement): void {
  const existing = entries.get(el.id);
  entries.set(el.id, {
    diagramId: el.diagramId,
    element: el,
    // The base is the server's version when this run of edits began
    base: existing ? existing.base : savedVersions(el.diagramId)?.get(el.id),
  });
}

export function stopJournal(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (writeTimer && projectId) {
    clearTimeout(writeTimer);
    writeTimer = null;
    void persistNow(projectId);
  }
  window.removeEventListener('visibilitychange', flushOnHide);
  window.removeEventListener('pagehide', flushOnHide);
  projectId = null;
  entries = new Map();
  publish();
}

/**
 * The server now has a diagram's edits: over REST (pass what it returned) or
 * through the live room (every update acknowledged — pass nothing).
 */
export function acknowledge(diagramId: string, serverElements?: MavisElement[]): void {
  const server = serverElements ? new Map(serverElements.map((el) => [el.id, el])) : null;
  let changed = false;
  for (const [id, entry] of entries) {
    if (entry.diagramId !== diagramId) continue;
    if (server) {
      const theirs = server.get(id);
      const done = entry.element.isDeleted
        ? !theirs
        : !!theirs &&
          (theirs.version >= entry.element.version || sameElementContent(theirs, entry.element));
      // A newer edit made while the save was in flight stays pending
      const current = useElementsStore.getState().elements.get(id);
      if (
        !done ||
        (current && current !== entry.element && current.version > entry.element.version)
      ) {
        continue;
      }
    }
    entries.delete(id);
    changed = true;
  }
  if (changed) {
    publish();
    persistSoon();
  }
}

export type RestoreDecision = 'apply' | 'already-saved' | 'conflict';

/**
 * Should an edit from a previous session be re-applied, given what the
 * server has for that element now?
 */
export function decideRestore(
  entry: Pick<JournalEntry, 'element' | 'base'>,
  server: MavisElement | undefined,
): RestoreDecision {
  const mine = entry.element;
  if (!server || server.isDeleted) {
    if (mine.isDeleted) return 'already-saved';
    // A brand-new element that never reached the server: bring it back.
    // One the server had (base) but no longer does: a teammate deleted it.
    return entry.base === undefined ? 'apply' : 'conflict';
  }
  if (!mine.isDeleted && sameElementContent(server, mine)) return 'already-saved';
  if (entry.base === undefined) return server.version <= mine.version ? 'apply' : 'conflict';
  return server.version === entry.base ? 'apply' : 'conflict';
}

export interface RestoreResult {
  restored: number;
  conflicts: number;
  /** Diagrams that have restored edits (need loading before applying). */
  diagrams: string[];
}

/** Read the journal a previous session left for this project. */
export async function readJournal(id: string): Promise<JournalEntry[]> {
  const stored = await kvGet<StoredJournal>(keyFor(id));
  return stored?.v === 1 && Array.isArray(stored.entries) ? stored.entries : [];
}

/**
 * Re-apply a previous session's unsaved edits on top of what was just loaded
 * from the server (the diagrams they belong to must be loaded). Returns the
 * entries still pending (to keep journaling) and what happened.
 */
export function applyJournal(saved: JournalEntry[]): {
  pending: JournalEntry[];
  result: RestoreResult;
} {
  const pending: JournalEntry[] = [];
  let restored = 0;
  let conflicts = 0;
  const elements = useElementsStore.getState().elements;
  const apply: MavisElement[] = [];
  for (const entry of saved) {
    const decision = decideRestore(entry, elements.get(entry.element.id));
    if (decision === 'conflict') conflicts++;
    if (decision !== 'apply') continue;
    apply.push(entry.element);
    pending.push(entry);
    restored++;
  }
  if (apply.length > 0) {
    // Not undoable (they're last session's edits), but they are unsaved, so
    // autosave picks them up
    withoutHistory(() =>
      useElementsStore.setState((prev) => {
        const next = new Map(prev.elements);
        for (const el of apply) next.set(el.id, el);
        return { elements: next };
      }),
    );
  }
  return {
    pending,
    result: { restored, conflicts, diagrams: Array.from(new Set(saved.map((e) => e.diagramId))) },
  };
}

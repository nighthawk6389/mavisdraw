import { create } from 'zustand';
import type { Diagram, MavisElement } from '@mavisdraw/types';
import { useElementsStore, isApplyingUnrecorded, withoutHistory } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';
import { diffElementMaps, sameElementContent } from '../stores/history';
import { toast } from '../stores/toastStore';
import { savedVersions } from './saveTracker';
import { kvDelete, kvGet, kvKeys, kvSet } from './localStore';

/**
 * Unsaved-edit journal: every local edit the server hasn't acknowledged yet
 * is kept in IndexedDB, with the server version it was based on. Close the
 * tab (or lose the network, or crash) and the edits come back the next time
 * the project is opened — and are only re-applied if nobody changed those
 * elements in the meantime.
 *
 * Each tab keeps its own journal, per account and project
 * (`journal:<user>:<project>:<tab>`): two tabs never overwrite each other's,
 * and another account on the same browser never sees them. A tab opening a
 * project takes over the journals of tabs that are gone (closed, crashed,
 * reloaded); one whose tab is still open is left to it. Signing out
 * discards the account's journals (after asking, see `unsavedOnDevice`).
 */

export interface JournalEntry {
  diagramId: string;
  /** The element as this user left it (isDeleted for a deletion). */
  element: MavisElement;
  /** Server version when this user started editing it (undefined: new element). */
  base?: number;
  /** Not re-applied yet: its diagram didn't load when the project opened. */
  deferred?: boolean;
}

interface StoredJournal {
  v: 1;
  /** When it was written (the newer of the two copies wins on read). */
  savedAt?: number;
  entries: JournalEntry[];
  /**
   * Nested diagrams made on this device the server hasn't confirmed yet
   * (drawn offline): without them, their shapes would have nowhere to go.
   */
  diagrams?: Diagram[];
}

// ── Which tab ────────────────────────────────────────────────

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Not a secure context (a self-hosted server on plain http)
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** This page's id: a reload is a new page, which takes over the old page's journal. */
const TAB_ID = randomId();
const TAB_LOCK_PREFIX = 'mavisdraw-tab:';
const TAB_CHANNEL = 'mavisdraw-tabs';

let announced = false;

/** Let other tabs see this one is open: it holds a lock until the page goes away. */
function announceTab(): void {
  if (announced) return;
  announced = true;
  try {
    void navigator.locks?.request(
      `${TAB_LOCK_PREFIX}${TAB_ID}`,
      () => new Promise<never>(() => {}),
    );
  } catch {
    // No Web Locks: the channel below answers instead
  }
  try {
    const channel = new BroadcastChannel(TAB_CHANNEL);
    channel.onmessage = (e: MessageEvent<{ type?: string }>) => {
      if (e.data?.type === 'who') channel.postMessage({ type: 'here', tab: TAB_ID });
    };
  } catch {
    // Neither: every other tab's journal is taken over
  }
}

/** The tabs open now (this one included), or null if this browser can't tell. */
async function openTabs(): Promise<Set<string> | null> {
  try {
    if (navigator.locks?.query) {
      const { held = [] } = await navigator.locks.query();
      return new Set(
        held
          .map((lock) => lock.name ?? '')
          .filter((name) => name.startsWith(TAB_LOCK_PREFIX))
          .map((name) => name.slice(TAB_LOCK_PREFIX.length)),
      );
    }
  } catch {
    // Fall through to asking over the channel
  }
  try {
    const channel = new BroadcastChannel(TAB_CHANNEL);
    const tabs = new Set<string>();
    channel.onmessage = (e: MessageEvent<{ type?: string; tab?: unknown }>) => {
      if (e.data?.type === 'here' && typeof e.data.tab === 'string') tabs.add(e.data.tab);
    };
    channel.postMessage({ type: 'who' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    channel.close();
    return tabs;
  } catch {
    return null;
  }
}

// ── Where journals are kept ──────────────────────────────────

const prefixFor = (userId: string, projectId?: string) =>
  projectId ? `journal:${userId}:${projectId}:` : `journal:${userId}:`;
const keyFor = (userId: string, projectId: string) => `${prefixFor(userId, projectId)}${TAB_ID}`;
const tabOf = (key: string) => key.slice(key.lastIndexOf(':') + 1);

/**
 * Synchronous backup written when the page is hidden or closed: an
 * IndexedDB write still in flight when the tab goes away may never land,
 * a localStorage write does. Skipped if it doesn't fit (images can be big).
 */
const backupKey = (key: string) => `mavisdraw:${key}`;

/**
 * Each element's JSON length, measured once: the store replaces an element
 * on every change (never mutates it), so during a drag only the shape being
 * moved is measured again, not every pasted image in the journal.
 */
const jsonLengths = new WeakMap<object, number>();

/** About how long the journal's JSON would be, without building it. */
function approxJsonLength(list: Iterable<JournalEntry>): number {
  let total = 64;
  for (const entry of list) {
    let n = jsonLengths.get(entry.element);
    if (n === undefined) {
      n = JSON.stringify(entry.element).length;
      jsonLengths.set(entry.element, n);
    }
    total += n + 80;
  }
  return total;
}

/** Write this journal's backup; whether it now holds every entry. */
function writeBackup(key: string): boolean {
  try {
    if (journalEmpty()) {
      localStorage.removeItem(backupKey(key));
      return true;
    }
    // Big journals (inline images) stay in IndexedDB only: known before
    // stringifying megabytes up to ten times a second only to drop them
    if (approxJsonLength(entries.values()) > MAX_BACKUP_CHARS) {
      localStorage.removeItem(backupKey(key));
      return false;
    }
    const payload: StoredJournal = {
      v: 1,
      savedAt: Date.now(),
      entries: Array.from(entries.values()),
      diagrams: currentDiagrams(),
    };
    const json = JSON.stringify(payload);
    // Big journals (inline images) stay in IndexedDB only
    if (json.length > MAX_BACKUP_CHARS) {
      localStorage.removeItem(backupKey(key));
      return false;
    }
    localStorage.setItem(backupKey(key), json);
    return true;
  } catch {
    // Quota exceeded or storage blocked: the IndexedDB copy is all we have
    return false;
  }
}

function readBackup(key: string): StoredJournal | null {
  try {
    const raw = localStorage.getItem(backupKey(key));
    return raw ? (JSON.parse(raw) as StoredJournal) : null;
  } catch {
    return null;
  }
}

function backupKeysWith(prefix: string): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(backupKey(prefix))) keys.push(k.slice(backupKey('').length));
    }
  } catch {
    // Storage blocked
  }
  return keys;
}

const valid = (j: StoredJournal | null | undefined): j is StoredJournal =>
  j?.v === 1 && Array.isArray(j.entries);

/** Every journal under a prefix, each from whichever of its two copies was written last. */
async function readAll(prefix: string): Promise<Map<string, StoredJournal>> {
  const keys = new Set([...(await kvKeys(prefix)), ...backupKeysWith(prefix)]);
  const out = new Map<string, StoredJournal>();
  for (const key of keys) {
    const newest = [await kvGet<StoredJournal>(key), readBackup(key)]
      .filter(valid)
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0];
    if (newest) out.set(key, newest);
  }
  return out;
}

async function dropKeys(keys: string[], { backups = true, stored = true } = {}): Promise<void> {
  if (backups) {
    for (const key of keys) {
      try {
        localStorage.removeItem(backupKey(key));
      } catch {
        // Storage blocked
      }
    }
  }
  if (stored) await Promise.all(keys.map((key) => kvDelete(key)));
}

/** Journals from before they were per account and tab: whose they were can't be known. */
function dropOldJournal(projectId: string): void {
  void kvDelete(`journal:${projectId}`);
  try {
    localStorage.removeItem(`mavisdraw:journal:${projectId}`);
  } catch {
    // Storage blocked
  }
}

// ── This tab's journal ───────────────────────────────────────

const MAX_BACKUP_CHARS = 1_500_000;
const BACKUP_INTERVAL_MS = 100;
let lastBackup = 0;
let backupTimer: ReturnType<typeof setTimeout> | null = null;

/** For the UI: how many edits are only on this device right now. */
export const useJournalStore = create<{ pending: number }>(() => ({ pending: 0 }));

let journalKey: string | null = null;
let ownerId: string | null = null;
let entries = new Map<string, JournalEntry>();
/** Nested diagrams made here and not yet confirmed by the server (by id). */
let newDiagrams = new Map<string, Diagram>();

/** As they are now (renamed since?), for storing. */
const currentDiagrams = (): Diagram[] =>
  Array.from(newDiagrams.values(), (d) => useDiagramStore.getState().diagrams.get(d.id) ?? d);

/** Nothing to keep: no unsaved edits, and no diagram the server lacks. */
const journalEmpty = () => entries.size === 0 && newDiagrams.size === 0;
let unsubscribe: (() => void) | null = null;

function publish(): void {
  useJournalStore.setState({ pending: entries.size });
}

/**
 * Keep the synchronous backup current: the first change is written at once
 * (a crash right after an edit can't lose it), bursts (drags) at most every
 * 100 ms with the latest state.
 */
function backupSoon(): void {
  const key = journalKey;
  if (!key) return;
  const wait = BACKUP_INTERVAL_MS - (Date.now() - lastBackup);
  if (wait <= 0 && !backupTimer) {
    lastBackup = Date.now();
    writeBackup(key);
    return;
  }
  if (backupTimer) return;
  backupTimer = setTimeout(
    () => {
      backupTimer = null;
      lastBackup = Date.now();
      if (journalKey === key) writeBackup(key);
    },
    Math.max(0, wait),
  );
}

/** A gesture ended (drag released, key up): its final state is backed up now. */
function flushBackup(): void {
  if (!backupTimer || !journalKey) return;
  clearTimeout(backupTimer);
  backupTimer = null;
  lastBackup = Date.now();
  writeBackup(journalKey);
}

/**
 * Write the journal now: one IndexedDB write in flight at a time, plus at
 * most one queued behind it with the latest state. No debounce, so even a
 * tab that's killed a moment after an edit (crash, OOM, forced close — no
 * unload events) has it on disk.
 */
let writing: Promise<void> | null = null;
let queued = false;

function persistSoon(): void {
  if (!journalKey) return;
  if (writing) {
    queued = true;
    return;
  }
  const key = journalKey;
  writing = persistNow(key).finally(() => {
    writing = null;
    if (queued && journalKey === key) {
      queued = false;
      persistSoon();
    }
  });
}

async function persistNow(key: string): Promise<void> {
  if (journalEmpty()) await kvDelete(key);
  else
    await kvSet(key, {
      v: 1,
      savedAt: Date.now(),
      entries: Array.from(entries.values()),
      diagrams: currentDiagrams(),
    } satisfies StoredJournal);
  // Nothing left to save: the backup goes too
  if (journalEmpty()) writeBackup(key);
}

/**
 * A nested diagram was made here: kept in the journal until the server
 * confirms it (`diagramConfirmed`), so one drawn offline survives the tab.
 */
export function journalNewDiagram(diagram: Diagram): void {
  if (!journalKey) return;
  newDiagrams.set(diagram.id, diagram);
  backupSoon();
  persistSoon();
}

/** The server has this diagram now. */
export function diagramConfirmed(diagramId: string): void {
  if (!journalKey || !newDiagrams.delete(diagramId)) return;
  backupSoon();
  persistSoon();
}

function flushOnHide(event?: Event): void {
  if (!journalKey) return;
  if (event?.type !== 'pagehide' && document.visibilityState !== 'hidden') return;
  writeBackup(journalKey); // lands even if the tab is gone a moment later
  void persistNow(journalKey);
}

/**
 * Start journaling local edits in a project (after its contents have
 * loaded), starting from `restored`. `adopted`: the journals of closed tabs
 * those came from, deleted once this tab's journal holds them.
 */
export function startJournal(
  userId: string,
  projectId: string,
  restored: JournalEntry[] = [],
  adopted: string[] = [],
  /** Nested diagrams recreated from the journal, still to reach the server. */
  restoredDiagrams: Diagram[] = [],
): void {
  stopJournal();
  announceTab();
  const key = keyFor(userId, projectId);
  journalKey = key;
  ownerId = userId;
  entries = new Map(restored.map((e) => [e.element.id, e]));
  newDiagrams = new Map(restoredDiagrams.map((d) => [d.id, d]));
  publish();
  // Outside the throttle: the first edit after opening must back up at once
  lastBackup = 0;
  const backedUp = writeBackup(key);
  const others = adopted.filter((k) => k !== key);
  // The closed tabs' copies go once this journal holds their edits
  if (backedUp) void dropKeys(others, { stored: false });
  void persistNow(key).then(() => dropKeys(others));

  unsubscribe = useElementsStore.subscribe((state, prev) => {
    if (state.elements === prev.elements || isApplyingUnrecorded()) return;
    // Worked out once per update for every subscriber (history.ts)
    const ids = diffElementMaps(prev.elements, state.elements);
    for (const elId of ids) {
      const el = state.elements.get(elId);
      if (el) record(el);
      else record({ ...prev.elements.get(elId)!, isDeleted: true } as MavisElement);
    }
    if (ids.length > 0) {
      publish();
      backupSoon();
      persistSoon();
    }
  });
  window.addEventListener('visibilitychange', flushOnHide);
  window.addEventListener('pagehide', flushOnHide);
  window.addEventListener('pointerup', flushBackup, true);
  window.addEventListener('keyup', flushBackup, true);
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
  flushBackup();
  if (queued && journalKey) {
    queued = false;
    void persistNow(journalKey);
  }
  window.removeEventListener('visibilitychange', flushOnHide);
  window.removeEventListener('pagehide', flushOnHide);
  window.removeEventListener('pointerup', flushBackup, true);
  window.removeEventListener('keyup', flushBackup, true);
  journalKey = null;
  ownerId = null;
  entries = new Map();
  newDiagrams = new Map();
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
    // A deferred edit isn't on the canvas yet, so the server can't have it
    if (entry.diagramId !== diagramId || entry.deferred) continue;
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
    backupSoon();
    persistSoon();
  }
}

// ── Signing out ──────────────────────────────────────────────

/** How many edits this account has on this device that the server doesn't. */
export async function unsavedOnDevice(userId: string): Promise<number> {
  const all = await readAll(prefixFor(userId));
  let count = 0;
  for (const [key, journal] of all) {
    if (key !== journalKey) count += journal.entries.length;
  }
  return count + (ownerId === userId ? entries.size : 0);
}

/** Forget this account's unsaved edits on this device (it's signing out). */
export async function discardJournals(userId: string): Promise<void> {
  if (ownerId === userId) {
    entries = new Map();
    queued = false;
    stopJournal();
  }
  await writing?.catch(() => undefined);
  const prefix = prefixFor(userId);
  const keys = new Set([...(await kvKeys(prefix)), ...backupKeysWith(prefix)]);
  await dropKeys(Array.from(keys));
}

// ── Bringing edits back ──────────────────────────────────────

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
  /** Kept for later: their diagram didn't load. */
  deferred: number;
  /** Diagrams that have restored edits (need loading before applying). */
  diagrams: string[];
}

export interface SavedJournal {
  entries: JournalEntry[];
  /** Nested diagrams made on this device that the server may not have. */
  diagrams: Diagram[];
  /** The closed tabs' journals they came from (for `startJournal`). */
  adopted: string[];
}

const newer = (a: MavisElement, b: MavisElement) =>
  a.version !== b.version ? a.version > b.version : (a.updatedAt ?? 0) > (b.updatedAt ?? 0);

/**
 * The unsaved edits this account left in a project on this device: from
 * every tab that's gone (one still open keeps saving its own).
 */
export async function readJournal(userId: string, projectId: string): Promise<SavedJournal> {
  dropOldJournal(projectId);
  announceTab();
  const [all, open] = await Promise.all([readAll(prefixFor(userId, projectId)), openTabs()]);
  const byElement = new Map<string, JournalEntry>();
  const diagrams = new Map<string, Diagram>();
  const adopted: string[] = [];
  for (const [key, journal] of all) {
    const tab = tabOf(key);
    if (tab !== TAB_ID && open?.has(tab)) continue;
    adopted.push(key);
    for (const entry of journal.entries) {
      const other = byElement.get(entry.element.id);
      if (!other || newer(entry.element, other.element)) byElement.set(entry.element.id, entry);
    }
    for (const d of journal.diagrams ?? []) {
      const other = diagrams.get(d.id);
      if (!other || d.updatedAt > other.updatedAt) diagrams.set(d.id, d);
    }
  }
  return {
    entries: Array.from(byElement.values()),
    diagrams: Array.from(diagrams.values()),
    adopted,
  };
}

/** Re-apply entries onto what's loaded; the rest are left out of `apply`. */
function sortEntries(saved: JournalEntry[], isLoaded: (diagramId: string) => boolean) {
  const elements = useElementsStore.getState().elements;
  const apply: JournalEntry[] = [];
  const deferred: JournalEntry[] = [];
  let conflicts = 0;
  for (const entry of saved) {
    if (!isLoaded(entry.diagramId)) {
      deferred.push({ ...entry, deferred: true });
      continue;
    }
    const decision = decideRestore(entry, elements.get(entry.element.id));
    if (decision === 'conflict') conflicts++;
    if (decision === 'apply') apply.push({ ...entry, deferred: undefined });
  }
  if (apply.length > 0) {
    // Not undoable (they're last session's edits), but they are unsaved, so
    // autosave picks them up
    withoutHistory(() =>
      useElementsStore.setState((prev) => {
        const next = new Map(prev.elements);
        for (const { element } of apply) next.set(element.id, element);
        return { elements: next };
      }),
    );
  }
  return { apply, deferred, conflicts };
}

/**
 * Re-apply a previous session's unsaved edits on top of what was just loaded
 * from the server. Edits for a diagram that didn't load are kept, and
 * applied once it does (`applyDeferred`). Returns the entries still pending
 * (to keep journaling) and what happened.
 */
export function applyJournal(
  saved: JournalEntry[],
  isLoaded: (diagramId: string) => boolean = () => true,
): { pending: JournalEntry[]; result: RestoreResult } {
  const { apply, deferred, conflicts } = sortEntries(saved, isLoaded);
  return {
    pending: [...apply, ...deferred],
    result: {
      restored: apply.length,
      conflicts,
      deferred: deferred.length,
      diagrams: Array.from(new Set(saved.map((e) => e.diagramId))),
    },
  };
}

/** A diagram that didn't load when the project opened has now: its kept edits go on. */
export function applyDeferred(diagramId: string): void {
  const waiting = Array.from(entries.values()).filter(
    (e) => e.deferred && e.diagramId === diagramId,
  );
  if (waiting.length === 0) return;
  const { apply, conflicts } = sortEntries(waiting, () => true);
  for (const entry of waiting) entries.delete(entry.element.id);
  for (const entry of apply) entries.set(entry.element.id, entry);
  publish();
  backupSoon();
  persistSoon();
  announceRestore({ restored: apply.length, conflicts, deferred: 0, diagrams: [diagramId] });
}

/** Tell the person what came back. */
export function announceRestore(result: RestoreResult): void {
  if (result.restored > 0) {
    toast(
      `Recovered ${result.restored} unsaved ${result.restored === 1 ? 'change' : 'changes'} from your last session.`,
      'success',
      undefined,
      10_000, // worth reading: it's about their work
    );
  }
  if (result.conflicts > 0) {
    toast(
      `${result.conflicts} of your unsaved ${result.conflicts === 1 ? 'change was' : 'changes were'} skipped: a teammate changed ${result.conflicts === 1 ? 'that shape' : 'those shapes'} since.`,
      'info',
    );
  }
  if (result.deferred > 0) {
    toast(
      `${result.deferred} unsaved ${result.deferred === 1 ? 'change is' : 'changes are'} kept on this device until ${result.deferred === 1 ? 'its level loads' : 'their level loads'}.`,
      'info',
    );
  }
}

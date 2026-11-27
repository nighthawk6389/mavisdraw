import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import { useElementsStore, withoutHistory } from '../stores/elementsStore';
import { recordSaved, resetSaveTracking } from '../services/saveTracker';
import { kvGet, kvSet } from '../services/localStore';
import {
  acknowledge,
  applyDeferred,
  applyJournal,
  decideRestore,
  discardJournals,
  readJournal,
  startJournal,
  stopJournal,
  unsavedOnDevice,
  useJournalStore,
} from '../services/offlineJournal';

const D = 'd1';
const U = 'u1';

/** This tab's synchronous backup for a project (its key ends with the tab's id). */
function backupFor(projectId: string, userId = U): string | null {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith(`mavisdraw:journal:${userId}:${projectId}:`)) return localStorage.getItem(k);
  }
  return null;
}
const box = (id: string, extra: Partial<MavisElement> = {}) =>
  ({
    ...useElementsStore.getState().createElement('rectangle', D, 0, 0, 100, 50),
    id,
    ...extra,
  }) as MavisElement;

describe('decideRestore', () => {
  it('re-applies an edit nobody else touched', () => {
    expect(
      decideRestore({ element: box('a', { x: 9, version: 4 }), base: 3 }, box('a', { version: 3 })),
    ).toBe('apply');
  });

  it('skips an edit a teammate superseded', () => {
    expect(
      decideRestore({ element: box('a', { x: 9, version: 9 }), base: 3 }, box('a', { version: 5 })),
    ).toBe('conflict');
  });

  it('knows when the edit already reached the server', () => {
    const mine = box('a', { x: 9, version: 4 });
    expect(decideRestore({ element: mine, base: 3 }, { ...mine })).toBe('already-saved');
    expect(decideRestore({ element: box('a', { isDeleted: true }), base: 3 }, undefined)).toBe(
      'already-saved',
    );
  });

  it('brings back a new element the server never got, but not one a teammate deleted', () => {
    expect(decideRestore({ element: box('new', { version: 2 }) }, undefined)).toBe('apply');
    expect(decideRestore({ element: box('gone', { version: 6 }), base: 5 }, undefined)).toBe(
      'conflict',
    );
  });
});

describe('journal', () => {
  beforeEach(() => {
    useElementsStore.setState({
      elements: new Map(),
      history: [],
      historyIndex: -1,
      clipboard: null,
    });
    resetSaveTracking();
  });
  afterEach(() => stopJournal());

  it('records local edits with the server version they were based on', async () => {
    const a = box('a', { version: 3 });
    useElementsStore.setState({ elements: new Map([['a', a]]) });
    recordSaved(D, [a]);
    startJournal(U, 'p1');
    useElementsStore.getState().updateElement('a', { x: 50 });
    useElementsStore.getState().updateElement('a', { x: 60 });
    expect(useJournalStore.getState().pending).toBe(1);
    stopJournal(); // persists
    const saved = (await readJournal(U, 'p1')).entries;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ diagramId: D, base: 3 });
    expect(saved[0].element.x).toBe(60);
  });

  it('does not journal remote changes or loads', () => {
    startJournal(U, 'p1');
    withoutHistory(() => useElementsStore.setState({ elements: new Map([['r', box('r')]]) }));
    expect(useJournalStore.getState().pending).toBe(0);
  });

  it('forgets edits once the server has them', () => {
    startJournal(U, 'p1');
    const a = box('a');
    useElementsStore.getState().addElement(a);
    expect(useJournalStore.getState().pending).toBe(1);
    acknowledge(D, [useElementsStore.getState().elements.get('a')!]);
    expect(useJournalStore.getState().pending).toBe(0);
  });

  it('a live-room acknowledgement clears the whole diagram', () => {
    startJournal(U, 'p1');
    useElementsStore.getState().addElement(box('a'));
    useElementsStore.getState().addElement(box('b'));
    acknowledge(D);
    expect(useJournalStore.getState().pending).toBe(0);
  });

  it('re-applies saved edits onto freshly loaded server state', () => {
    const server = box('a', { version: 3 });
    withoutHistory(() => useElementsStore.setState({ elements: new Map([['a', server]]) }));
    const historyBefore = useElementsStore.getState().history.length;
    const { pending, result } = applyJournal([
      { diagramId: D, element: box('a', { x: 77, version: 4 }), base: 3 },
      { diagramId: D, element: box('b', { version: 1 }) },
    ]);
    expect(result).toMatchObject({ restored: 2, conflicts: 0, deferred: 0 });
    expect(pending).toHaveLength(2);
    expect(useElementsStore.getState().elements.get('a')!.x).toBe(77);
    expect(useElementsStore.getState().elements.has('b')).toBe(true);
    // Not an undo step: it's last session's work
    expect(useElementsStore.getState().history).toHaveLength(historyBefore);
  });

  it('closing the tab leaves a synchronous backup, and the newest copy wins', async () => {
    const a = box('a', { version: 3 });
    withoutHistory(() => useElementsStore.setState({ elements: new Map([['a', a]]) }));
    recordSaved(D, [a]);
    startJournal(U, 'p2');
    useElementsStore.getState().updateElement('a', { x: 99 });
    // The tab goes away before the debounced IndexedDB write
    window.dispatchEvent(new Event('pagehide'));
    expect(backupFor('p2')).toContain('"x":99');
    const saved = (await readJournal(U, 'p2')).entries;
    expect(saved[0].element.x).toBe(99);
    stopJournal();
  });

  it('backs up every edit synchronously, so a tab killed without unload events keeps it', () => {
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(1000); // outside any earlier test's throttle window
      const a = box('a', { version: 3 });
      withoutHistory(() => useElementsStore.setState({ elements: new Map([['a', a]]) }));
      recordSaved(D, [a]);
      startJournal(U, 'p3');
      useElementsStore.getState().updateElement('a', { x: 41 });
      // Written at once, not on the next tick
      expect(backupFor('p3')).toContain('"x":41');
      // A burst (a drag) is throttled, and the latest state lands
      useElementsStore.getState().updateElement('a', { x: 42 });
      useElementsStore.getState().updateElement('a', { x: 43 });
      vi.advanceTimersByTime(100);
      expect(backupFor('p3')).toContain('"x":43');
      // Releasing the mouse lands a drag's final state without waiting
      useElementsStore.getState().updateElement('a', { x: 44 });
      useElementsStore.getState().updateElement('a', { x: 45 });
      window.dispatchEvent(new Event('pointerup'));
      expect(backupFor('p3')).toContain('"x":45');
      // Once the server has everything, the backup goes
      acknowledge(D);
      vi.advanceTimersByTime(100);
      expect(backupFor('p3')).toBeNull();
    } finally {
      stopJournal();
      vi.useRealTimers();
    }
  });
});

describe('journals per account and tab', () => {
  const entry = (id: string, extra: Partial<MavisElement> = {}, diagramId = D) => ({
    diagramId,
    element: box(id, { diagramId, ...extra }),
  });
  /** A journal left by another tab (stored as that tab would have). */
  const leave = (userId: string, projectId: string, tab: string, entries: unknown[]) =>
    kvSet(`journal:${userId}:${projectId}:${tab}`, { v: 1, savedAt: Date.now(), entries });

  beforeEach(() => {
    useElementsStore.setState({ elements: new Map(), history: [], historyIndex: -1 });
    resetSaveTracking();
    localStorage.clear();
    // The tab "live" is still open (it holds its lock); every other tab is gone
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: vi.fn(() => new Promise(() => {})),
        query: async () => ({ held: [{ name: 'mavisdraw-tab:live' }] }),
      },
    });
  });
  afterEach(() => stopJournal());

  it('another account on this browser never gets them', async () => {
    startJournal('alice', 'shared');
    useElementsStore.getState().addElement(box('a'));
    stopJournal();
    expect((await readJournal('bob', 'shared')).entries).toEqual([]);
    expect((await readJournal('alice', 'shared')).entries).toHaveLength(1);
  });

  it('takes over closed tabs’ journals (newest copy of each shape), not an open tab’s', async () => {
    await leave(U, 'p', 'closed1', [entry('a', { x: 1, version: 2 }), entry('b')]);
    await leave(U, 'p', 'closed2', [entry('a', { x: 2, version: 3 })]);
    await leave(U, 'p', 'live', [entry('c')]);
    const saved = await readJournal(U, 'p');
    const byId = Object.fromEntries(saved.entries.map((e) => [e.element.id, e.element]));
    expect(Object.keys(byId).sort()).toEqual(['a', 'b']);
    expect(byId.a.x).toBe(2);

    // Once this tab's journal holds them, the closed tabs' copies go
    startJournal(U, 'p', saved.entries, saved.adopted);
    await vi.waitFor(async () => expect(await kvGet(`journal:${U}:p:closed1`)).toBeUndefined());
    expect(await kvGet(`journal:${U}:p:closed2`)).toBeUndefined();
    expect(await kvGet(`journal:${U}:p:live`)).toBeDefined();
  });

  it('keeps edits for a level that didn’t load, and applies them once it does', async () => {
    const server = box('n', { diagramId: 'nested', version: 3 });
    const { pending, result } = applyJournal(
      [entry('r', { version: 2 }), { ...entry('n', { x: 55, version: 4 }, 'nested'), base: 3 }],
      (d) => d !== 'nested',
    );
    expect(result).toMatchObject({ restored: 1, conflicts: 0, deferred: 1 });
    startJournal(U, 'p', pending);
    // Not on the canvas, so no acknowledgement can clear it
    acknowledge('nested');
    expect(useJournalStore.getState().pending).toBe(2);

    // The level loads later in the session
    withoutHistory(() =>
      useElementsStore.setState((prev) => ({
        elements: new Map([...prev.elements, ['n', server]]),
      })),
    );
    applyDeferred('nested');
    expect(useElementsStore.getState().elements.get('n')!.x).toBe(55);
    // Now it's an ordinary pending edit, saved like any other
    acknowledge('nested');
    expect(useJournalStore.getState().pending).toBe(1);
  });

  it('signing out counts and discards only that account’s edits on this device', async () => {
    await leave('carol', 'p1', 'closed', [entry('a'), entry('b')]);
    await leave('dave', 'p1', 'closed', [entry('c')]);
    startJournal('carol', 'p2');
    useElementsStore.getState().addElement(box('d'));
    expect(await unsavedOnDevice('carol')).toBe(3);

    await discardJournals('carol');
    expect(useJournalStore.getState().pending).toBe(0);
    expect(await unsavedOnDevice('carol')).toBe(0);
    expect(backupFor('p2', 'carol')).toBeNull();
    expect(await unsavedOnDevice('dave')).toBe(1);
  });
});

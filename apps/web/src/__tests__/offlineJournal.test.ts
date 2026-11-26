import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import { useElementsStore, withoutHistory } from '../stores/elementsStore';
import { recordSaved, resetSaveTracking } from '../services/saveTracker';
import {
  acknowledge,
  applyJournal,
  decideRestore,
  readJournal,
  startJournal,
  stopJournal,
  useJournalStore,
} from '../services/offlineJournal';

const D = 'd1';
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
    startJournal('p1');
    useElementsStore.getState().updateElement('a', { x: 50 });
    useElementsStore.getState().updateElement('a', { x: 60 });
    expect(useJournalStore.getState().pending).toBe(1);
    stopJournal(); // persists
    const saved = await readJournal('p1');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ diagramId: D, base: 3 });
    expect(saved[0].element.x).toBe(60);
  });

  it('does not journal remote changes or loads', () => {
    startJournal('p1');
    withoutHistory(() => useElementsStore.setState({ elements: new Map([['r', box('r')]]) }));
    expect(useJournalStore.getState().pending).toBe(0);
  });

  it('forgets edits once the server has them', () => {
    startJournal('p1');
    const a = box('a');
    useElementsStore.getState().addElement(a);
    expect(useJournalStore.getState().pending).toBe(1);
    acknowledge(D, [useElementsStore.getState().elements.get('a')!]);
    expect(useJournalStore.getState().pending).toBe(0);
  });

  it('a live-room acknowledgement clears the whole diagram', () => {
    startJournal('p1');
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
    expect(result).toMatchObject({ restored: 2, conflicts: 0 });
    expect(pending).toHaveLength(2);
    expect(useElementsStore.getState().elements.get('a')!.x).toBe(77);
    expect(useElementsStore.getState().elements.has('b')).toBe(true);
    // Not an undo step: it's last session's work
    expect(useElementsStore.getState().history).toHaveLength(historyBefore);
  });
});

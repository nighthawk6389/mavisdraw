import { describe, it, expect, beforeEach } from 'vitest';
import type { LinearElement, MavisElement, TextElement } from '@mavisdraw/types';
import {
  useElementsStore,
  applyRemoteChanges,
  withoutHistory,
  sortByStacking,
  reorder,
} from '../../stores/elementsStore';
import { parseClipboardEnvelope } from '../../editor/actions';

const D = 'diagram-1';

function store() {
  return useElementsStore.getState();
}

function reset() {
  useElementsStore.setState({
    elements: new Map(),
    history: [],
    historyIndex: -1,
    clipboard: null,
  });
}

function addRect(x = 0, y = 0, w = 100, h = 60): MavisElement {
  const el = store().createElement('rectangle', D, x, y, w, h);
  store().addElement(el);
  return el;
}

/** Removed from the canvas: absent, or soft-deleted (a tombstone collaborators can see). */
function isGone(id: string): boolean {
  return store().elements.get(id)?.isDeleted ?? true;
}

function get(id: string): MavisElement {
  return store().elements.get(id)!;
}

/** Simulate a collaborator's edit arriving over the network. */
function remoteUpdate(id: string, changes: Partial<MavisElement>) {
  applyRemoteChanges(() =>
    useElementsStore.setState((s) => {
      const next = new Map(s.elements);
      const cur = next.get(id)!;
      next.set(id, { ...cur, ...changes, version: cur.version + 1 } as MavisElement);
      return { elements: next };
    }),
  );
}

function remoteAdd(el: MavisElement) {
  applyRemoteChanges(() =>
    useElementsStore.setState((s) => {
      const next = new Map(s.elements);
      next.set(el.id, el);
      return { elements: next };
    }),
  );
}

describe('patch-based history', () => {
  beforeEach(reset);

  it('undo only reverts the local user’s change, not a collaborator’s', () => {
    const mine = addRect(0, 0);
    const theirs = store().createElement('ellipse', D, 300, 300, 50, 50);
    remoteAdd(theirs);

    store().updateElement(mine.id, { x: 50 });
    remoteUpdate(theirs.id, { x: 999 });

    store().undo();

    expect(get(mine.id).x).toBe(0);
    // The collaborator's element and edit are untouched
    expect(get(theirs.id).x).toBe(999);
  });

  it('undo keeps a collaborator’s later change to the same shape', () => {
    const shape = addRect(0, 0);
    store().updateElement(shape.id, { x: 50 }); // I move it
    remoteUpdate(shape.id, { x: 400 }); // then a teammate moves it
    store().undo();
    expect(get(shape.id).x).toBe(400);
  });

  it('undo reverts my property but keeps their different property', () => {
    const shape = addRect(0, 0);
    store().updateElement(shape.id, { strokeColor: '#e03131' }); // I recolour it
    remoteUpdate(shape.id, { x: 400 }); // a teammate moves it
    store().undo();
    expect(get(shape.id).strokeColor).not.toBe('#e03131');
    expect(get(shape.id).x).toBe(400);

    store().redo();
    expect(get(shape.id).strokeColor).toBe('#e03131');
    expect(get(shape.id).x).toBe(400);
  });

  it('undo of a resize keeps a teammate’s later move', () => {
    const shape = addRect(0, 0, 100, 60);
    store().updateElement(shape.id, { width: 300, height: 200 });
    remoteUpdate(shape.id, { x: 80, y: 90 });
    store().undo();
    expect(get(shape.id)).toMatchObject({ width: 100, height: 60, x: 80, y: 90 });
  });

  it('a skipped undo does not bump the version (no needless sync traffic)', () => {
    const shape = addRect(0, 0);
    store().updateElement(shape.id, { x: 50 });
    remoteUpdate(shape.id, { x: 400 });
    const version = get(shape.id).version;
    store().undo();
    expect(get(shape.id).version).toBe(version);
  });

  it('undoing a creation leaves a newer tombstone, not a missing element', () => {
    const el = addRect();
    store().undo();
    const tomb = store().elements.get(el.id)!;
    expect(tomb.isDeleted).toBe(true);
    expect(tomb.version).toBeGreaterThan(el.version);
    store().redo();
    expect(get(el.id).isDeleted).toBe(false);
    expect(get(el.id).version).toBeGreaterThan(tomb.version);
  });

  it('undo never deletes elements a collaborator added', () => {
    addRect();
    const theirs = store().createElement('diamond', D, 10, 10, 20, 20);
    remoteAdd(theirs);
    store().undo(); // reverts my add
    expect(store().elements.has(theirs.id)).toBe(true);
  });

  it('remote-only changes are not undoable', () => {
    const theirs = store().createElement('ellipse', D, 0, 0, 50, 50);
    remoteAdd(theirs);
    expect(store().canUndo()).toBe(false);
  });

  it('a batched gesture (drag) is a single undo step', () => {
    const el = addRect(0, 0);
    store().beginHistoryBatch();
    for (let i = 1; i <= 20; i++) {
      store().pushHistory(); // what nested code paths do; absorbed by the batch
      store().updateElementSilent(el.id, { x: i * 5 });
    }
    store().endHistoryBatch();
    expect(get(el.id).x).toBe(100);

    store().undo();
    expect(get(el.id).x).toBe(0);
    // One more undo removes the rectangle (its creation step)
    store().undo();
    expect(isGone(el.id)).toBe(true);
  });

  it('a click that changes nothing does not create an undo step', () => {
    const el = addRect(0, 0);
    store().beginHistoryBatch();
    store().endHistoryBatch();
    store().beginHistoryBatch();
    store().endHistoryBatch();
    store().undo();
    expect(isGone(el.id)).toBe(true);
  });

  it('coalesces rapid changes with the same key (slider drags)', () => {
    const el = addRect();
    for (const opacity of [90, 80, 70, 60]) {
      store().pushHistory('opacity');
      store().updateElementSilent(el.id, { opacity });
    }
    expect(get(el.id).opacity).toBe(60);
    store().undo();
    expect(get(el.id).opacity).toBe(100);
  });

  it('different keys produce separate steps', () => {
    const el = addRect();
    store().pushHistory('opacity');
    store().updateElementSilent(el.id, { opacity: 50 });
    store().pushHistory('roughness');
    store().updateElementSilent(el.id, { roughness: 2 });
    store().undo();
    expect(get(el.id).roughness).toBe(1);
    expect(get(el.id).opacity).toBe(50);
  });

  it('redo re-applies exactly what undo removed, with a newer version', () => {
    const el = addRect(0, 0);
    store().updateElement(el.id, { x: 40 });
    const before = get(el.id).version;
    store().undo();
    store().redo();
    expect(get(el.id).x).toBe(40);
    expect(get(el.id).version).toBeGreaterThan(before);
  });

  it('changes made while history is suppressed are not recorded', () => {
    const el = addRect(0, 0);
    withoutHistory(() => store().updateElementSilent(el.id, { opacity: 10 }));
    store().undo();
    // Undo removed the rectangle (the only recorded step); the silent change wasn't a step
    expect(isGone(el.id)).toBe(true);
  });

  it('amendLastHistoryEntry folds typing into the creation step', () => {
    const el = store().createElement('text', D, 0, 0, 100, 20);
    store().beginHistoryBatch();
    store().addElement(el);
    store().endHistoryBatch();
    store().amendLastHistoryEntry(() =>
      store().updateElement(el.id, { text: 'Hello' } as Partial<MavisElement>),
    );
    store().undo();
    expect(isGone(el.id)).toBe(true);
    expect(store().canUndo()).toBe(false);
  });

  it('history memory is proportional to what changed, not diagram size', () => {
    for (let i = 0; i < 200; i++) {
      withoutHistory(() =>
        useElementsStore.setState((s) => {
          const next = new Map(s.elements);
          const el = store().createElement('rectangle', D, i, i, 10, 10);
          next.set(el.id, el);
          return { elements: next };
        }),
      );
    }
    const first = Array.from(store().elements.values())[0];
    store().updateElement(first.id, { x: 5000 });
    const entry = store().history[store().historyIndex];
    expect(entry.before.size).toBe(1);
  });
});

describe('binding integrity', () => {
  beforeEach(reset);

  function shapeWithLabel(): { shape: MavisElement; label: TextElement } {
    const shape = addRect(100, 100, 200, 100);
    const label = store().createBoundText(shape.id, 'API');
    return { shape, label };
  }

  function boundArrow(from: MavisElement, to: MavisElement): LinearElement {
    const arrow = store().createElement(
      'arrow',
      D,
      from.x + from.width,
      from.y + 50,
      100,
      0,
    ) as LinearElement;
    store().addElement(arrow);
    store().bindArrow(arrow.id, 'start', from.id, 0);
    store().bindArrow(arrow.id, 'end', to.id, 0);
    return store().elements.get(arrow.id) as LinearElement;
  }

  it('deleting a shape deletes its label', () => {
    const { shape, label } = shapeWithLabel();
    store().deleteElements([shape.id]);
    expect(get(label.id).isDeleted).toBe(true);
  });

  it('deleting a shape frees (but keeps) arrows bound to it', () => {
    const a = addRect(0, 0);
    const b = addRect(400, 0);
    const arrow = boundArrow(a, b);
    store().deleteElements([b.id]);
    const after = get(arrow.id) as LinearElement;
    expect(after.isDeleted).toBe(false);
    expect(after.endBinding).toBeNull();
    expect(after.startBinding?.elementId).toBe(a.id);
  });

  it('deleting an arrow removes it from the shapes’ boundElements', () => {
    const a = addRect(0, 0);
    const b = addRect(400, 0);
    const arrow = boundArrow(a, b);
    store().deleteElements([arrow.id]);
    expect(get(a.id).boundElements.some((x) => x.id === arrow.id)).toBe(false);
    expect(get(b.id).boundElements.some((x) => x.id === arrow.id)).toBe(false);
  });

  it('locked elements are not deleted', () => {
    const el = addRect();
    store().setElementsLocked([el.id], true);
    store().deleteElements([el.id]);
    expect(get(el.id).isDeleted).toBe(false);
  });

  it('resizing a shape re-fits its label to the new box', () => {
    const { shape, label } = shapeWithLabel();
    store().updateElement(shape.id, { width: 400, height: 300 });
    const l = get(label.id);
    expect(l.width).toBe(380);
    expect(l.height).toBe(280);
  });

  it('resizing a shape keeps bound arrows attached', () => {
    const a = addRect(0, 0, 100, 100);
    const b = addRect(400, 0, 100, 100);
    const arrow = boundArrow(a, b);
    store().updateElement(b.id, { x: 600, width: 200 });
    const after = get(arrow.id) as LinearElement;
    const end = after.points[after.points.length - 1];
    // End point lands on b's left edge (x = 600)
    expect(after.x + end[0]).toBeCloseTo(600, 0);
  });

  it('aligning shapes moves their labels and arrows with them', () => {
    const { shape, label } = shapeWithLabel();
    const other = addRect(500, 400, 100, 60);
    store().alignElements([shape.id, other.id], 'top');
    expect(get(shape.id).y).toBe(100);
    expect(get(other.id).y).toBe(100);
    expect(get(label.id).y).toBe(get(shape.id).y + 10);
  });

  it('copy includes labels, and paste remaps every reference to the copies', () => {
    const { shape, label } = shapeWithLabel();
    store().copyElements([shape.id]);
    const pasted = store().pasteElements(D);
    expect(pasted).toHaveLength(2);
    const newShape = pasted.find((e) => e.type === 'rectangle')!;
    const newLabel = pasted.find((e) => e.type === 'text') as TextElement;
    expect(newLabel.containerId).toBe(newShape.id);
    expect(newShape.boundElements.map((b) => b.id)).toEqual([newLabel.id]);
    // Nothing points back at the originals
    expect(newShape.boundElements.some((b) => b.id === label.id)).toBe(false);
  });

  it('paste drops references to elements that were not copied', () => {
    const a = addRect(0, 0);
    const b = addRect(400, 0);
    boundArrow(a, b);
    store().copyElements([a.id]);
    const [copy] = store().pasteElements(D);
    expect(copy.boundElements).toEqual([]);
  });

  it('paste with an anchor centers the pasted group on it', () => {
    const el = addRect(0, 0, 100, 50);
    store().copyElements([el.id]);
    const [copy] = store().pasteElements(D, { x: 1000, y: 1000 });
    expect(copy.x).toBe(950);
    expect(copy.y).toBe(975);
  });

  it('duplicating does not overwrite the clipboard', () => {
    const a = addRect(0, 0);
    const b = addRect(300, 0);
    store().copyElements([a.id]);
    store().duplicateElements([b.id]);
    expect(store().clipboard?.elements[0].id).toBe(a.id);
  });
});

describe('stacking order', () => {
  beforeEach(reset);

  it('new elements stack above older ones', () => {
    const a = addRect();
    const b = addRect();
    expect(sortByStacking([get(b.id), get(a.id)]).map((e) => e.id)).toEqual([a.id, b.id]);
  });

  it('labels render directly above their container', () => {
    const shape = addRect();
    const label = store().createBoundText(shape.id, 'x');
    const top = addRect();
    const order = sortByStacking([get(top.id), get(label.id), get(shape.id)]).map((e) => e.id);
    expect(order).toEqual([shape.id, label.id, top.id]);
  });

  it('bring to front / send to back reorder and persist via zIndex', () => {
    const a = addRect();
    const b = addRect();
    const c = addRect();
    store().reorderElements([a.id], 'front');
    const ids = () => sortByStacking(Array.from(store().elements.values())).map((e) => e.id);
    expect(ids()).toEqual([b.id, c.id, a.id]);
    store().reorderElements([a.id], 'back');
    expect(ids()).toEqual([a.id, b.id, c.id]);
    store().undo();
    expect(ids()).toEqual([b.id, c.id, a.id]);
  });

  it('reorder forward/backward moves one step at a time', () => {
    expect(reorder(['a', 'b', 'c', 'd'], new Set(['b']), 'forward')).toEqual(['a', 'c', 'b', 'd']);
    expect(reorder(['a', 'b', 'c', 'd'], new Set(['c']), 'backward')).toEqual(['a', 'c', 'b', 'd']);
    expect(reorder(['a', 'b', 'c'], new Set(['c']), 'forward')).toEqual(['a', 'b', 'c']);
  });
});

describe('clipboard envelope parsing', () => {
  it('accepts MavisDraw clipboard JSON', () => {
    const text = JSON.stringify({ type: 'mavisdraw-clipboard', elements: [] });
    expect(parseClipboardEnvelope(text)).toEqual({ type: 'mavisdraw-clipboard', elements: [] });
  });

  it('ignores plain text and foreign JSON', () => {
    expect(parseClipboardEnvelope('hello')).toBeNull();
    expect(parseClipboardEnvelope('{"type":"excalidraw"}')).toBeNull();
    expect(parseClipboardEnvelope('mavisdraw-clipboard but not json')).toBeNull();
  });
});

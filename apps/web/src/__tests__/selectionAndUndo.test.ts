import { describe, it, expect, beforeEach } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import { useElementsStore } from '../stores/elementsStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useLayerStore } from '../stores/layerStore';
import { useDiagramStore } from '../stores/diagramStore';
import { selectAll, pasteInternal } from '../editor/actions';
import { shortcutsStandAside } from '../hooks/useKeyboard';

const store = () => useElementsStore.getState();
const selected = () => Array.from(useSelectionStore.getState().selectedIds).sort();

function addRect(x: number, extra: Partial<MavisElement> = {}): MavisElement {
  const diagramId = useDiagramStore.getState().activeDiagramId;
  const el = {
    ...store().createElement('rectangle', diagramId, x, 0, 100, 60),
    ...extra,
  } as MavisElement;
  store().addElement(el);
  return el;
}

beforeEach(() => {
  useElementsStore.setState({
    elements: new Map(),
    history: [],
    historyIndex: -1,
    clipboard: null,
  });
  useSelectionStore.getState().clearSelection();
});

describe('select all', () => {
  it('leaves out locked shapes and what’s on hidden or locked layers', () => {
    // (made before the new layers, which become the active one)
    const a = addRect(0);
    addRect(200, { isLocked: true });
    const layers = useLayerStore.getState();
    const hidden = layers.addLayer('Hidden');
    const locked = layers.addLayer('Locked');
    useLayerStore.getState().setLayerVisibility(hidden.id, false);
    useLayerStore.getState().setLayerLocked(locked.id, true);
    addRect(400, { layerId: hidden.id });
    addRect(600, { layerId: locked.id });
    selectAll();
    expect(selected()).toEqual([a.id]);
  });
});

describe('undo and the selection', () => {
  it('undoing a delete brings the shape back selected; redo leaves nothing selected', () => {
    const a = addRect(0);
    useSelectionStore.getState().selectMultiple([a.id]);
    store().pushHistory();
    store().deleteElements([a.id]);
    useSelectionStore.getState().clearSelection();
    store().undo();
    expect(selected()).toEqual([a.id]);
    store().redo();
    expect(selected()).toEqual([]);
  });

  it('never selects something that isn’t there any more', () => {
    const a = addRect(0);
    const b = addRect(200);
    useSelectionStore.getState().selectMultiple([a.id, b.id]);
    store().pushHistory();
    store().updateElementSilent(a.id, { x: 50 });
    // b is gone by the time of the undo (a collaborator deleted it)
    store().deleteElements([b.id]);
    useElementsStore.setState({ historyIndex: 1 });
    store().undo();
    expect(selected()).not.toContain(b.id);
  });
});

describe('pasting', () => {
  it('pasting again at the same spot steps each copy along instead of stacking them', () => {
    const a = addRect(0);
    store().copyElements([a.id]);
    const first = pasteInternal({ x: 500, y: 500 })[0];
    const second = pasteInternal({ x: 500, y: 500 })[0];
    const third = pasteInternal({ x: 500, y: 500 })[0];
    expect(second.x - first.x).toBe(20);
    expect(third.y - second.y).toBe(20);
    // Somewhere else: no step
    const elsewhere = pasteInternal({ x: 100, y: 100 })[0];
    expect(elsewhere.x + elsewhere.width / 2).toBeCloseTo(100);
  });
});

describe('which keys the shortcuts leave alone', () => {
  const key = (k: string, target: HTMLElement, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    Object.defineProperty(e, 'target', { value: target });
    return e;
  };

  it('a menu’s, a toolbar’s and a select’s own keys', () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.appendChild(item);
    expect(shortcutsStandAside(key('ArrowDown', item))).toBe(true);
    expect(shortcutsStandAside(key('Enter', item))).toBe(true);
    expect(shortcutsStandAside(key('r', document.createElement('select')))).toBe(true);
  });

  it('Enter and Space on a focused button, but not letter shortcuts', () => {
    const button = document.createElement('button');
    expect(shortcutsStandAside(key('Enter', button))).toBe(true);
    expect(shortcutsStandAside(key(' ', button))).toBe(true);
    expect(shortcutsStandAside(key('r', button))).toBe(false);
    expect(shortcutsStandAside(key('ArrowLeft', button))).toBe(false);
  });

  it('anything inside a modal dialog, and keys already handled', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    const button = document.createElement('button');
    dialog.appendChild(button);
    expect(shortcutsStandAside(key('r', button))).toBe(true);
    const handled = key('Delete', document.body);
    handled.preventDefault();
    expect(shortcutsStandAside(handled)).toBe(true);
    expect(shortcutsStandAside(key('Delete', document.body))).toBe(false);
  });
});

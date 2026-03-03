import { describe, it, expect, beforeEach } from 'vitest';
import { useElementsStore } from '../../stores/elementsStore';

function resetStore() {
  useElementsStore.setState({
    elements: new Map(),
    history: [],
    historyIndex: -1,
  });
}

describe('elementsStore', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('createElement', () => {
    it('creates a rectangle element', () => {
      const el = useElementsStore.getState().createElement('rectangle', 'diagram-1', 10, 20, 100, 50);
      expect(el.type).toBe('rectangle');
      expect(el.x).toBe(10);
      expect(el.y).toBe(20);
      expect(el.width).toBe(100);
      expect(el.height).toBe(50);
      expect(el.diagramId).toBe('diagram-1');
      expect(el.id).toBeTruthy();
      if (el.type === 'rectangle') {
        expect(el.roundness).toBe(0);
      }
    });

    it('creates an ellipse element', () => {
      const el = useElementsStore.getState().createElement('ellipse', 'd1', 0, 0, 50, 50);
      expect(el.type).toBe('ellipse');
    });

    it('creates a diamond element', () => {
      const el = useElementsStore.getState().createElement('diamond', 'd1', 0, 0, 50, 50);
      expect(el.type).toBe('diamond');
    });

    it('creates a triangle element', () => {
      const el = useElementsStore.getState().createElement('triangle', 'd1', 0, 0, 50, 50);
      expect(el.type).toBe('triangle');
    });

    it('creates a line element with default points', () => {
      const el = useElementsStore.getState().createElement('line', 'd1', 0, 0, 100, 50);
      expect(el.type).toBe('line');
      if (el.type === 'line') {
        expect(el.points).toEqual([[0, 0], [100, 50]]);
        expect(el.startArrowhead).toBe('none');
        expect(el.endArrowhead).toBe('none');
      }
    });

    it('creates an arrow element with arrowhead', () => {
      const el = useElementsStore.getState().createElement('arrow', 'd1', 0, 0, 100, 50);
      expect(el.type).toBe('arrow');
      if (el.type === 'arrow') {
        expect(el.endArrowhead).toBe('arrow');
        expect(el.startArrowhead).toBe('none');
      }
    });

    it('creates a freedraw element', () => {
      const el = useElementsStore.getState().createElement('freedraw', 'd1', 0, 0, 0, 0);
      expect(el.type).toBe('freedraw');
      if (el.type === 'freedraw') {
        expect(el.points).toEqual([[0, 0]]);
      }
    });

    it('creates a text element with defaults', () => {
      const el = useElementsStore.getState().createElement('text', 'd1', 10, 10, 100, 20);
      expect(el.type).toBe('text');
      if (el.type === 'text') {
        expect(el.text).toBe('');
        expect(el.fontSize).toBe(20);
        expect(el.fontFamily).toBe('hand-drawn');
      }
    });

    it('creates a portal element', () => {
      const el = useElementsStore.getState().createElement('portal', 'd1', 0, 0, 80, 80);
      expect(el.type).toBe('portal');
      if (el.type === 'portal') {
        expect(el.label).toBe('Portal');
        expect(el.portalStyle).toBe('card');
      }
    });

    it('creates an image element', () => {
      const el = useElementsStore.getState().createElement('image', 'd1', 0, 0, 100, 50);
      expect(el.type).toBe('image');
    });

    it('assigns unique ids', () => {
      const store = useElementsStore.getState();
      const el1 = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      const el2 = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      expect(el1.id).not.toBe(el2.id);
    });

    it('applies default styles', () => {
      const el = useElementsStore.getState().createElement('rectangle', 'd1', 0, 0, 10, 10);
      expect(el.strokeColor).toBe('#1e1e1e');
      expect(el.backgroundColor).toBe('transparent');
      expect(el.strokeWidth).toBe(2);
      expect(el.opacity).toBe(100);
      expect(el.isLocked).toBe(false);
      expect(el.isDeleted).toBe(false);
      expect(el.version).toBe(1);
    });
  });

  describe('addElement', () => {
    it('adds an element to the store', () => {
      const store = useElementsStore.getState();
      const el = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      store.addElement(el);
      expect(useElementsStore.getState().elements.get(el.id)).toBeDefined();
      expect(useElementsStore.getState().elements.size).toBe(1);
    });

    it('pushes history when adding', () => {
      const store = useElementsStore.getState();
      const el = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      store.addElement(el);
      expect(useElementsStore.getState().canUndo()).toBe(true);
    });
  });

  describe('updateElement', () => {
    it('updates element properties', () => {
      const store = useElementsStore.getState();
      const el = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      store.addElement(el);
      useElementsStore.getState().updateElement(el.id, { x: 50, y: 50 });
      const updated = useElementsStore.getState().elements.get(el.id)!;
      expect(updated.x).toBe(50);
      expect(updated.y).toBe(50);
    });

    it('increments version on update', () => {
      const store = useElementsStore.getState();
      const el = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      store.addElement(el);
      const originalVersion = useElementsStore.getState().elements.get(el.id)!.version;
      useElementsStore.getState().updateElement(el.id, { x: 50 });
      expect(useElementsStore.getState().elements.get(el.id)!.version).toBe(originalVersion + 1);
    });

    it('does nothing for non-existent id', () => {
      const store = useElementsStore.getState();
      const sizeBefore = store.elements.size;
      store.updateElement('non-existent', { x: 50 });
      expect(useElementsStore.getState().elements.size).toBe(sizeBefore);
    });
  });

  describe('deleteElement', () => {
    it('soft-deletes an element', () => {
      const store = useElementsStore.getState();
      const el = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      store.addElement(el);
      useElementsStore.getState().deleteElement(el.id);
      const deleted = useElementsStore.getState().elements.get(el.id)!;
      expect(deleted.isDeleted).toBe(true);
    });

    it('does nothing for non-existent id', () => {
      const store = useElementsStore.getState();
      store.deleteElement('non-existent');
      expect(useElementsStore.getState().elements.size).toBe(0);
    });
  });

  describe('deleteElements', () => {
    it('soft-deletes multiple elements', () => {
      const store = useElementsStore.getState();
      const el1 = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      const el2 = store.createElement('ellipse', 'd1', 20, 20, 10, 10);
      store.addElement(el1);
      useElementsStore.getState().addElement(el2);
      useElementsStore.getState().deleteElements([el1.id, el2.id]);
      expect(useElementsStore.getState().elements.get(el1.id)!.isDeleted).toBe(true);
      expect(useElementsStore.getState().elements.get(el2.id)!.isDeleted).toBe(true);
    });

    it('does nothing when none of the ids exist', () => {
      const store = useElementsStore.getState();
      const historyBefore = store.history.length;
      store.deleteElements(['non-existent']);
      expect(useElementsStore.getState().history.length).toBe(historyBefore);
    });
  });

  describe('setElements', () => {
    it('replaces all elements and resets history', () => {
      const store = useElementsStore.getState();
      const el1 = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      store.addElement(el1);

      const el2 = useElementsStore.getState().createElement('ellipse', 'd1', 20, 20, 10, 10);
      useElementsStore.getState().setElements([el2]);

      expect(useElementsStore.getState().elements.size).toBe(1);
      expect(useElementsStore.getState().elements.get(el2.id)).toBeDefined();
      expect(useElementsStore.getState().elements.get(el1.id)).toBeUndefined();
      expect(useElementsStore.getState().history.length).toBe(0);
    });
  });

  describe('query methods', () => {
    it('getElementById returns element or undefined', () => {
      const store = useElementsStore.getState();
      const el = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      store.addElement(el);
      expect(useElementsStore.getState().getElementById(el.id)).toBeDefined();
      expect(useElementsStore.getState().getElementById('non-existent')).toBeUndefined();
    });

    it('getElementsByDiagram filters by diagramId', () => {
      const store = useElementsStore.getState();
      const el1 = store.createElement('rectangle', 'diagram-a', 0, 0, 10, 10);
      const el2 = store.createElement('rectangle', 'diagram-b', 0, 0, 10, 10);
      store.addElement(el1);
      useElementsStore.getState().addElement(el2);
      const result = useElementsStore.getState().getElementsByDiagram('diagram-a');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(el1.id);
    });

    it('getVisibleElements excludes deleted elements', () => {
      const store = useElementsStore.getState();
      const el1 = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      const el2 = store.createElement('rectangle', 'd1', 20, 20, 10, 10);
      store.addElement(el1);
      useElementsStore.getState().addElement(el2);
      useElementsStore.getState().deleteElement(el1.id);
      const visible = useElementsStore.getState().getVisibleElements('d1');
      expect(visible.length).toBe(1);
      expect(visible[0].id).toBe(el2.id);
    });
  });

  describe('undo/redo', () => {
    it('canUndo returns false initially', () => {
      expect(useElementsStore.getState().canUndo()).toBe(false);
    });

    it('canRedo returns false initially', () => {
      expect(useElementsStore.getState().canRedo()).toBe(false);
    });

    it('undo restores previous state', () => {
      const store = useElementsStore.getState();
      const el = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      store.addElement(el);

      expect(useElementsStore.getState().elements.size).toBe(1);

      useElementsStore.getState().undo();
      expect(useElementsStore.getState().elements.size).toBe(0);
    });

    it('redo restores undone state', () => {
      const store = useElementsStore.getState();
      const el = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      store.addElement(el);

      useElementsStore.getState().undo();
      expect(useElementsStore.getState().elements.size).toBe(0);

      useElementsStore.getState().redo();
      expect(useElementsStore.getState().elements.size).toBe(1);
    });

    it('undo does nothing when no history', () => {
      useElementsStore.getState().undo();
      expect(useElementsStore.getState().elements.size).toBe(0);
    });

    it('redo does nothing when at latest state', () => {
      const store = useElementsStore.getState();
      const el = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      store.addElement(el);
      useElementsStore.getState().redo();
      expect(useElementsStore.getState().elements.size).toBe(1);
    });

    it('new action after undo discards redo history', () => {
      const store = useElementsStore.getState();
      const el1 = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
      store.addElement(el1);

      const el2 = useElementsStore.getState().createElement('ellipse', 'd1', 20, 20, 10, 10);
      useElementsStore.getState().addElement(el2);

      // Undo the second add
      useElementsStore.getState().undo();
      expect(useElementsStore.getState().elements.size).toBe(1);

      // Add a new element (should discard redo)
      const el3 = useElementsStore.getState().createElement('diamond', 'd1', 40, 40, 10, 10);
      useElementsStore.getState().addElement(el3);

      expect(useElementsStore.getState().canRedo()).toBe(false);
    });
  });

  describe('alignElements', () => {
    it('aligns two rectangles and keeps finite positions', () => {
      const store = useElementsStore.getState();
      const r1 = store.createElement('rectangle', 'd1', 10, 20, 50, 40);
      const r2 = store.createElement('rectangle', 'd1', 100, 80, 50, 40);
      store.addElement(r1);
      store.addElement(r2);
      store.alignElements([r1.id, r2.id], 'left');
      const el1 = useElementsStore.getState().elements.get(r1.id)!;
      const el2 = useElementsStore.getState().elements.get(r2.id)!;
      expect(Number.isFinite(el1.x)).toBe(true);
      expect(Number.isFinite(el1.y)).toBe(true);
      expect(Number.isFinite(el2.x)).toBe(true);
      expect(Number.isFinite(el2.y)).toBe(true);
      expect(el1.x).toBe(10);
      expect(el2.x).toBe(10);
    });

    it('aligns rectangle and arrow without producing NaN', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 50, 50, 60, 40);
      const arrow = store.createElement('arrow', 'd1', 200, 100, 80, 30);
      store.addElement(rect);
      store.addElement(arrow);
      useElementsStore.getState().alignElements([rect.id, arrow.id], 'left');
      const r = useElementsStore.getState().elements.get(rect.id)!;
      const a = useElementsStore.getState().elements.get(arrow.id)!;
      expect(Number.isFinite(r.x) && Number.isFinite(r.y)).toBe(true);
      expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
    });
  });

  describe('distributeElements', () => {
    it('distributes three rectangles and keeps finite positions', () => {
      const store = useElementsStore.getState();
      const r1 = store.createElement('rectangle', 'd1', 0, 0, 30, 20);
      const r2 = store.createElement('rectangle', 'd1', 50, 0, 30, 20);
      const r3 = store.createElement('rectangle', 'd1', 120, 0, 30, 20);
      store.addElement(r1);
      store.addElement(r2);
      store.addElement(r3);
      useElementsStore.getState().distributeElements([r1.id, r2.id, r3.id], 'horizontal');
      for (const id of [r1.id, r2.id, r3.id]) {
        const el = useElementsStore.getState().elements.get(id)!;
        expect(Number.isFinite(el.x)).toBe(true);
        expect(Number.isFinite(el.y)).toBe(true);
      }
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useElementsStore } from '../../stores/elementsStore';
import type { LinearElement, TextElement } from '@mavisdraw/types';

function resetStore() {
  useElementsStore.setState({
    elements: new Map(),
    history: [],
    historyIndex: -1,
    clipboard: null,
  });
}

describe('elementsStore - Stage 2', () => {
  beforeEach(() => {
    resetStore();
  });

  // ── Arrow Binding ───────────────────────────────────────

  describe('bindArrow', () => {
    it('binds an arrow start to a shape', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 100, 100, 50, 50);
      store.addElement(rect);
      const arrow = useElementsStore.getState().createElement('arrow', 'd1', 50, 50, 80, 80);
      useElementsStore.getState().addElement(arrow);

      useElementsStore.getState().bindArrow(arrow.id, 'start', rect.id, 5);

      const updatedArrow = useElementsStore.getState().getElementById(arrow.id) as LinearElement;
      expect(updatedArrow.startBinding).not.toBeNull();
      expect(updatedArrow.startBinding?.elementId).toBe(rect.id);
      expect(updatedArrow.startBinding?.gap).toBe(5);

      const updatedRect = useElementsStore.getState().getElementById(rect.id)!;
      expect(updatedRect.boundElements.some((b) => b.id === arrow.id)).toBe(true);
    });

    it('binds an arrow end to a shape', () => {
      const store = useElementsStore.getState();
      const ellipse = store.createElement('ellipse', 'd1', 200, 200, 60, 40);
      store.addElement(ellipse);
      const arrow = useElementsStore.getState().createElement('arrow', 'd1', 50, 50, 180, 180);
      useElementsStore.getState().addElement(arrow);

      useElementsStore.getState().bindArrow(arrow.id, 'end', ellipse.id, 3);

      const updatedArrow = useElementsStore.getState().getElementById(arrow.id) as LinearElement;
      expect(updatedArrow.endBinding).not.toBeNull();
      expect(updatedArrow.endBinding?.elementId).toBe(ellipse.id);
    });

    it('does nothing for non-existent arrow', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 0, 0, 50, 50);
      store.addElement(rect);

      useElementsStore.getState().bindArrow('non-existent', 'start', rect.id, 5);
      // Should not throw
    });
  });

  describe('unbindArrow', () => {
    it('unbinds an arrow from a shape', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 100, 100, 50, 50);
      store.addElement(rect);
      const arrow = useElementsStore.getState().createElement('arrow', 'd1', 50, 50, 80, 80);
      useElementsStore.getState().addElement(arrow);

      useElementsStore.getState().bindArrow(arrow.id, 'end', rect.id, 5);
      useElementsStore.getState().unbindArrow(arrow.id, 'end');

      const updatedArrow = useElementsStore.getState().getElementById(arrow.id) as LinearElement;
      expect(updatedArrow.endBinding).toBeNull();

      const updatedRect = useElementsStore.getState().getElementById(rect.id)!;
      expect(updatedRect.boundElements.some((b) => b.id === arrow.id)).toBe(false);
    });

    it('does nothing when no binding exists', () => {
      const store = useElementsStore.getState();
      const arrow = store.createElement('arrow', 'd1', 50, 50, 80, 80);
      store.addElement(arrow);

      // Should not throw
      useElementsStore.getState().unbindArrow(arrow.id, 'start');
    });
  });

  describe('moveElementWithBindings', () => {
    it('moves element and updates position', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 100, 100, 50, 50);
      store.addElement(rect);

      useElementsStore.getState().moveElementWithBindings(rect.id, 200, 200);

      const moved = useElementsStore.getState().getElementById(rect.id)!;
      expect(moved.x).toBe(200);
      expect(moved.y).toBe(200);
    });
  });

  // ── Text-in-Shape Binding ──────────────────────────────

  describe('createBoundText', () => {
    it('creates a text element bound to a shape', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 100, 100, 200, 100);
      store.addElement(rect);

      const textEl = useElementsStore.getState().createBoundText(rect.id, 'Hello');

      expect(textEl.type).toBe('text');
      expect(textEl.containerId).toBe(rect.id);
      expect(textEl.text).toBe('Hello');
      expect(textEl.textAlign).toBe('center');
      expect(textEl.verticalAlign).toBe('middle');

      // Container should have bound text in its boundElements
      const updatedRect = useElementsStore.getState().getElementById(rect.id)!;
      expect(updatedRect.boundElements.some((b) => b.id === textEl.id && b.type === 'text')).toBe(true);
    });

    it('positions text inside shape with padding', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 50, 50, 200, 100);
      store.addElement(rect);

      const textEl = useElementsStore.getState().createBoundText(rect.id, 'Test');

      // Text should be positioned inside the shape with padding
      expect(textEl.x).toBeGreaterThan(50);
      expect(textEl.y).toBeGreaterThan(50);
      expect(textEl.width).toBeLessThan(200);
      expect(textEl.height).toBeLessThan(100);
    });

    it('throws for non-existent container', () => {
      expect(() => {
        useElementsStore.getState().createBoundText('non-existent', 'Hello');
      }).toThrow();
    });
  });

  // ── Grouping ───────────────────────────────────────────

  describe('groupElements', () => {
    it('adds groupId to all selected elements', () => {
      const store = useElementsStore.getState();
      const rect1 = store.createElement('rectangle', 'd1', 0, 0, 50, 50);
      store.addElement(rect1);
      const rect2 = useElementsStore.getState().createElement('rectangle', 'd1', 100, 100, 50, 50);
      useElementsStore.getState().addElement(rect2);

      const groupId = useElementsStore.getState().groupElements([rect1.id, rect2.id]);

      expect(groupId).toBeTruthy();

      const updatedRect1 = useElementsStore.getState().getElementById(rect1.id)!;
      const updatedRect2 = useElementsStore.getState().getElementById(rect2.id)!;

      expect(updatedRect1.groupIds).toContain(groupId);
      expect(updatedRect2.groupIds).toContain(groupId);
    });

    it('returns empty string for fewer than 2 elements', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 0, 0, 50, 50);
      store.addElement(rect);

      const groupId = useElementsStore.getState().groupElements([rect.id]);
      expect(groupId).toBe('');
    });

    it('supports nested groups', () => {
      const store = useElementsStore.getState();
      const rect1 = store.createElement('rectangle', 'd1', 0, 0, 50, 50);
      store.addElement(rect1);
      const rect2 = useElementsStore.getState().createElement('rectangle', 'd1', 100, 100, 50, 50);
      useElementsStore.getState().addElement(rect2);
      const rect3 = useElementsStore.getState().createElement('rectangle', 'd1', 200, 200, 50, 50);
      useElementsStore.getState().addElement(rect3);

      // Group rect1 and rect2
      const innerGroupId = useElementsStore.getState().groupElements([rect1.id, rect2.id]);

      // Group the inner group with rect3
      const outerGroupId = useElementsStore.getState().groupElements([rect1.id, rect2.id, rect3.id]);

      const updated1 = useElementsStore.getState().getElementById(rect1.id)!;
      expect(updated1.groupIds).toContain(innerGroupId);
      expect(updated1.groupIds).toContain(outerGroupId);
      expect(updated1.groupIds.length).toBe(2);
    });
  });

  describe('ungroupElements', () => {
    it('removes outermost group from elements', () => {
      const store = useElementsStore.getState();
      const rect1 = store.createElement('rectangle', 'd1', 0, 0, 50, 50);
      store.addElement(rect1);
      const rect2 = useElementsStore.getState().createElement('rectangle', 'd1', 100, 100, 50, 50);
      useElementsStore.getState().addElement(rect2);

      const groupId = useElementsStore.getState().groupElements([rect1.id, rect2.id]);
      useElementsStore.getState().ungroupElements([rect1.id, rect2.id]);

      const updated1 = useElementsStore.getState().getElementById(rect1.id)!;
      const updated2 = useElementsStore.getState().getElementById(rect2.id)!;

      expect(updated1.groupIds).not.toContain(groupId);
      expect(updated2.groupIds).not.toContain(groupId);
    });

    it('does nothing when no groups exist', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 0, 0, 50, 50);
      store.addElement(rect);

      // Should not throw
      useElementsStore.getState().ungroupElements([rect.id]);

      const updated = useElementsStore.getState().getElementById(rect.id)!;
      expect(updated.groupIds).toEqual([]);
    });
  });

  // ── Copy/Paste/Duplicate ────────────────────────────────

  describe('copyElements', () => {
    it('copies elements to clipboard', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 50, 50, 100, 100);
      store.addElement(rect);

      useElementsStore.getState().copyElements([rect.id]);

      const clipboard = useElementsStore.getState().clipboard;
      expect(clipboard).not.toBeNull();
      expect(clipboard!.elements).toHaveLength(1);
      expect(clipboard!.elements[0].id).toBe(rect.id);
    });

    it('copies multiple elements', () => {
      const store = useElementsStore.getState();
      const rect1 = store.createElement('rectangle', 'd1', 0, 0, 50, 50);
      store.addElement(rect1);
      const rect2 = useElementsStore.getState().createElement('ellipse', 'd1', 100, 100, 50, 50);
      useElementsStore.getState().addElement(rect2);

      useElementsStore.getState().copyElements([rect1.id, rect2.id]);

      const clipboard = useElementsStore.getState().clipboard;
      expect(clipboard!.elements).toHaveLength(2);
    });

    it('ignores deleted elements', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 0, 0, 50, 50);
      store.addElement(rect);
      useElementsStore.getState().deleteElement(rect.id);

      useElementsStore.getState().copyElements([rect.id]);

      const clipboard = useElementsStore.getState().clipboard;
      expect(clipboard).toBeNull();
    });
  });

  describe('pasteElements', () => {
    it('pastes elements with new IDs', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 50, 50, 100, 100);
      store.addElement(rect);

      useElementsStore.getState().copyElements([rect.id]);
      const pasted = useElementsStore.getState().pasteElements('d1');

      expect(pasted).toHaveLength(1);
      expect(pasted[0].id).not.toBe(rect.id);
      expect(pasted[0].type).toBe('rectangle');
    });

    it('offsets pasted elements by 10,10', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 50, 50, 100, 100);
      store.addElement(rect);

      useElementsStore.getState().copyElements([rect.id]);
      const pasted = useElementsStore.getState().pasteElements('d1');

      expect(pasted[0].x).toBe(60);
      expect(pasted[0].y).toBe(60);
    });

    it('preserves group relationships with new IDs', () => {
      const store = useElementsStore.getState();
      const rect1 = store.createElement('rectangle', 'd1', 0, 0, 50, 50);
      store.addElement(rect1);
      const rect2 = useElementsStore.getState().createElement('rectangle', 'd1', 100, 100, 50, 50);
      useElementsStore.getState().addElement(rect2);

      const groupId = useElementsStore.getState().groupElements([rect1.id, rect2.id]);

      useElementsStore.getState().copyElements([rect1.id, rect2.id]);
      const pasted = useElementsStore.getState().pasteElements('d1');

      expect(pasted).toHaveLength(2);
      // Both pasted elements should have a group ID, but different from original
      expect(pasted[0].groupIds).toHaveLength(1);
      expect(pasted[1].groupIds).toHaveLength(1);
      expect(pasted[0].groupIds[0]).toBe(pasted[1].groupIds[0]);
      expect(pasted[0].groupIds[0]).not.toBe(groupId);
    });

    it('returns empty array when no clipboard data', () => {
      const pasted = useElementsStore.getState().pasteElements('d1');
      expect(pasted).toEqual([]);
    });
  });

  describe('duplicateElements', () => {
    it('duplicates elements with offset', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 50, 50, 100, 100);
      store.addElement(rect);

      const duplicated = useElementsStore.getState().duplicateElements([rect.id]);

      expect(duplicated).toHaveLength(1);
      expect(duplicated[0].id).not.toBe(rect.id);
      expect(duplicated[0].x).toBe(60);
      expect(duplicated[0].y).toBe(60);
    });

    it('adds duplicated elements to the store', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 0, 0, 50, 50);
      store.addElement(rect);

      const duplicated = useElementsStore.getState().duplicateElements([rect.id]);

      expect(useElementsStore.getState().elements.has(duplicated[0].id)).toBe(true);
    });
  });

  // ── Alignment ──────────────────────────────────────────

  describe('alignElements', () => {
    it('aligns elements to the left', () => {
      const store = useElementsStore.getState();
      const rect1 = store.createElement('rectangle', 'd1', 50, 100, 40, 30);
      store.addElement(rect1);
      const rect2 = useElementsStore.getState().createElement('rectangle', 'd1', 200, 200, 60, 40);
      useElementsStore.getState().addElement(rect2);

      useElementsStore.getState().alignElements([rect1.id, rect2.id], 'left');

      const updated1 = useElementsStore.getState().getElementById(rect1.id)!;
      const updated2 = useElementsStore.getState().getElementById(rect2.id)!;

      expect(updated1.x).toBe(50);
      expect(updated2.x).toBe(50);
    });

    it('aligns elements to the right', () => {
      const store = useElementsStore.getState();
      const rect1 = store.createElement('rectangle', 'd1', 50, 100, 40, 30);
      store.addElement(rect1);
      const rect2 = useElementsStore.getState().createElement('rectangle', 'd1', 200, 200, 60, 40);
      useElementsStore.getState().addElement(rect2);

      useElementsStore.getState().alignElements([rect1.id, rect2.id], 'right');

      const updated1 = useElementsStore.getState().getElementById(rect1.id)!;
      const updated2 = useElementsStore.getState().getElementById(rect2.id)!;

      // Right edge = max(50+40, 200+60) = 260
      expect(updated1.x + updated1.width).toBe(260);
      expect(updated2.x + updated2.width).toBe(260);
    });

    it('aligns elements to the top', () => {
      const store = useElementsStore.getState();
      const rect1 = store.createElement('rectangle', 'd1', 50, 100, 40, 30);
      store.addElement(rect1);
      const rect2 = useElementsStore.getState().createElement('rectangle', 'd1', 200, 200, 60, 40);
      useElementsStore.getState().addElement(rect2);

      useElementsStore.getState().alignElements([rect1.id, rect2.id], 'top');

      const updated1 = useElementsStore.getState().getElementById(rect1.id)!;
      const updated2 = useElementsStore.getState().getElementById(rect2.id)!;

      expect(updated1.y).toBe(100);
      expect(updated2.y).toBe(100);
    });

    it('aligns elements to center horizontal', () => {
      const store = useElementsStore.getState();
      const rect1 = store.createElement('rectangle', 'd1', 0, 0, 40, 30);
      store.addElement(rect1);
      const rect2 = useElementsStore.getState().createElement('rectangle', 'd1', 100, 0, 60, 40);
      useElementsStore.getState().addElement(rect2);

      useElementsStore.getState().alignElements([rect1.id, rect2.id], 'center-horizontal');

      const updated1 = useElementsStore.getState().getElementById(rect1.id)!;
      const updated2 = useElementsStore.getState().getElementById(rect2.id)!;

      // Center = (0 + 160) / 2 = 80
      expect(updated1.x + updated1.width / 2).toBeCloseTo(80);
      expect(updated2.x + updated2.width / 2).toBeCloseTo(80);
    });

    it('does nothing with fewer than 2 elements', () => {
      const store = useElementsStore.getState();
      const rect = store.createElement('rectangle', 'd1', 50, 100, 40, 30);
      store.addElement(rect);

      useElementsStore.getState().alignElements([rect.id], 'left');

      const updated = useElementsStore.getState().getElementById(rect.id)!;
      expect(updated.x).toBe(50);
    });
  });

  describe('distributeElements', () => {
    it('distributes elements horizontally', () => {
      const store = useElementsStore.getState();
      const rect1 = store.createElement('rectangle', 'd1', 0, 0, 20, 20);
      store.addElement(rect1);
      const rect2 = useElementsStore.getState().createElement('rectangle', 'd1', 50, 0, 20, 20);
      useElementsStore.getState().addElement(rect2);
      const rect3 = useElementsStore.getState().createElement('rectangle', 'd1', 100, 0, 20, 20);
      useElementsStore.getState().addElement(rect3);

      useElementsStore.getState().distributeElements(
        [rect1.id, rect2.id, rect3.id],
        'horizontal',
      );

      const updated1 = useElementsStore.getState().getElementById(rect1.id)!;
      const updated2 = useElementsStore.getState().getElementById(rect2.id)!;
      const updated3 = useElementsStore.getState().getElementById(rect3.id)!;

      // First and last should stay in place
      expect(updated1.x).toBe(0);
      expect(updated3.x).toBe(100);

      // Middle element should be evenly distributed
      // Gap = (120 - 60) / 2 = 30, so rect2.x = 0 + 20 + 30 = 50
      const gap1 = updated2.x - (updated1.x + updated1.width);
      const gap2 = updated3.x - (updated2.x + updated2.width);
      expect(gap1).toBeCloseTo(gap2);
    });

    it('distributes elements vertically', () => {
      const store = useElementsStore.getState();
      const rect1 = store.createElement('rectangle', 'd1', 0, 0, 20, 20);
      store.addElement(rect1);
      const rect2 = useElementsStore.getState().createElement('rectangle', 'd1', 0, 50, 20, 20);
      useElementsStore.getState().addElement(rect2);
      const rect3 = useElementsStore.getState().createElement('rectangle', 'd1', 0, 100, 20, 20);
      useElementsStore.getState().addElement(rect3);

      useElementsStore.getState().distributeElements(
        [rect1.id, rect2.id, rect3.id],
        'vertical',
      );

      const updated2 = useElementsStore.getState().getElementById(rect2.id)!;
      const updated1 = useElementsStore.getState().getElementById(rect1.id)!;
      const updated3 = useElementsStore.getState().getElementById(rect3.id)!;

      const gap1 = updated2.y - (updated1.y + updated1.height);
      const gap2 = updated3.y - (updated2.y + updated2.height);
      expect(gap1).toBeCloseTo(gap2);
    });

    it('does nothing with fewer than 3 elements', () => {
      const store = useElementsStore.getState();
      const rect1 = store.createElement('rectangle', 'd1', 0, 0, 20, 20);
      store.addElement(rect1);
      const rect2 = useElementsStore.getState().createElement('rectangle', 'd1', 100, 0, 20, 20);
      useElementsStore.getState().addElement(rect2);

      useElementsStore.getState().distributeElements([rect1.id, rect2.id], 'horizontal');

      // Positions should not change
      expect(useElementsStore.getState().getElementById(rect1.id)!.x).toBe(0);
      expect(useElementsStore.getState().getElementById(rect2.id)!.x).toBe(100);
    });
  });

  // ── updateElements (bulk) ──────────────────────────────

  describe('updateElements', () => {
    it('updates multiple elements at once', () => {
      const store = useElementsStore.getState();
      const rect1 = store.createElement('rectangle', 'd1', 0, 0, 50, 50);
      store.addElement(rect1);
      const rect2 = useElementsStore.getState().createElement('rectangle', 'd1', 100, 100, 50, 50);
      useElementsStore.getState().addElement(rect2);

      useElementsStore.getState().updateElements([
        { id: rect1.id, changes: { strokeColor: '#ff0000' } },
        { id: rect2.id, changes: { strokeColor: '#00ff00' } },
      ]);

      expect(useElementsStore.getState().getElementById(rect1.id)!.strokeColor).toBe('#ff0000');
      expect(useElementsStore.getState().getElementById(rect2.id)!.strokeColor).toBe('#00ff00');
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useSelectionStore } from '../../stores/selectionStore';

function resetStore() {
  useSelectionStore.setState({
    selectedIds: new Set<string>(),
    selectionBox: null,
    hoveredId: null,
    _selectionStart: null,
  });
}

describe('selectionStore', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('initial state', () => {
    it('starts with empty selection', () => {
      expect(useSelectionStore.getState().selectedIds.size).toBe(0);
    });

    it('starts with no selection box', () => {
      expect(useSelectionStore.getState().selectionBox).toBeNull();
    });

    it('starts with no hovered element', () => {
      expect(useSelectionStore.getState().hoveredId).toBeNull();
    });
  });

  describe('select', () => {
    it('selects a single element', () => {
      useSelectionStore.getState().select('el-1');
      expect(useSelectionStore.getState().selectedIds.has('el-1')).toBe(true);
      expect(useSelectionStore.getState().selectedIds.size).toBe(1);
    });

    it('replaces previous selection', () => {
      useSelectionStore.getState().select('el-1');
      useSelectionStore.getState().select('el-2');
      expect(useSelectionStore.getState().selectedIds.has('el-1')).toBe(false);
      expect(useSelectionStore.getState().selectedIds.has('el-2')).toBe(true);
      expect(useSelectionStore.getState().selectedIds.size).toBe(1);
    });
  });

  describe('selectMultiple', () => {
    it('selects multiple elements', () => {
      useSelectionStore.getState().selectMultiple(['el-1', 'el-2', 'el-3']);
      expect(useSelectionStore.getState().selectedIds.size).toBe(3);
    });

    it('replaces previous selection', () => {
      useSelectionStore.getState().select('el-1');
      useSelectionStore.getState().selectMultiple(['el-2', 'el-3']);
      expect(useSelectionStore.getState().selectedIds.has('el-1')).toBe(false);
      expect(useSelectionStore.getState().selectedIds.size).toBe(2);
    });
  });

  describe('addToSelection', () => {
    it('adds element to existing selection', () => {
      useSelectionStore.getState().select('el-1');
      useSelectionStore.getState().addToSelection('el-2');
      expect(useSelectionStore.getState().selectedIds.size).toBe(2);
      expect(useSelectionStore.getState().selectedIds.has('el-1')).toBe(true);
      expect(useSelectionStore.getState().selectedIds.has('el-2')).toBe(true);
    });
  });

  describe('removeFromSelection', () => {
    it('removes element from selection', () => {
      useSelectionStore.getState().selectMultiple(['el-1', 'el-2']);
      useSelectionStore.getState().removeFromSelection('el-1');
      expect(useSelectionStore.getState().selectedIds.has('el-1')).toBe(false);
      expect(useSelectionStore.getState().selectedIds.has('el-2')).toBe(true);
    });

    it('does nothing for non-selected id', () => {
      useSelectionStore.getState().select('el-1');
      useSelectionStore.getState().removeFromSelection('el-99');
      expect(useSelectionStore.getState().selectedIds.size).toBe(1);
    });
  });

  describe('toggleSelection', () => {
    it('adds if not selected', () => {
      useSelectionStore.getState().toggleSelection('el-1');
      expect(useSelectionStore.getState().selectedIds.has('el-1')).toBe(true);
    });

    it('removes if already selected', () => {
      useSelectionStore.getState().select('el-1');
      useSelectionStore.getState().toggleSelection('el-1');
      expect(useSelectionStore.getState().selectedIds.has('el-1')).toBe(false);
    });
  });

  describe('selectAll', () => {
    it('selects all provided ids', () => {
      useSelectionStore.getState().selectAll(['el-1', 'el-2', 'el-3']);
      expect(useSelectionStore.getState().selectedIds.size).toBe(3);
    });
  });

  describe('clearSelection', () => {
    it('clears all selections', () => {
      useSelectionStore.getState().selectMultiple(['el-1', 'el-2']);
      useSelectionStore.getState().clearSelection();
      expect(useSelectionStore.getState().selectedIds.size).toBe(0);
    });

    it('also clears selection box', () => {
      useSelectionStore.getState().startSelectionBox({ x: 0, y: 0 });
      useSelectionStore.getState().clearSelection();
      expect(useSelectionStore.getState().selectionBox).toBeNull();
    });
  });

  describe('setHovered', () => {
    it('sets hovered element id', () => {
      useSelectionStore.getState().setHovered('el-1');
      expect(useSelectionStore.getState().hoveredId).toBe('el-1');
    });

    it('clears hovered element', () => {
      useSelectionStore.getState().setHovered('el-1');
      useSelectionStore.getState().setHovered(null);
      expect(useSelectionStore.getState().hoveredId).toBeNull();
    });
  });

  describe('selection box', () => {
    it('starts a selection box', () => {
      useSelectionStore.getState().startSelectionBox({ x: 10, y: 20 });
      expect(useSelectionStore.getState().selectionBox).toEqual({
        x: 10,
        y: 20,
        width: 0,
        height: 0,
      });
    });

    it('updates selection box as cursor moves', () => {
      useSelectionStore.getState().startSelectionBox({ x: 10, y: 10 });
      useSelectionStore.getState().updateSelectionBox({ x: 50, y: 60 });
      expect(useSelectionStore.getState().selectionBox).toEqual({
        x: 10,
        y: 10,
        width: 40,
        height: 50,
      });
    });

    it('handles negative direction (drag up-left)', () => {
      useSelectionStore.getState().startSelectionBox({ x: 50, y: 50 });
      useSelectionStore.getState().updateSelectionBox({ x: 10, y: 20 });
      const box = useSelectionStore.getState().selectionBox!;
      expect(box.x).toBe(10);
      expect(box.y).toBe(20);
      expect(box.width).toBe(40);
      expect(box.height).toBe(30);
    });

    it('endSelectionBox returns final box and clears', () => {
      useSelectionStore.getState().startSelectionBox({ x: 0, y: 0 });
      useSelectionStore.getState().updateSelectionBox({ x: 100, y: 100 });
      const box = useSelectionStore.getState().endSelectionBox();
      expect(box).toEqual({ x: 0, y: 0, width: 100, height: 100 });
      expect(useSelectionStore.getState().selectionBox).toBeNull();
    });

    it('updateSelectionBox does nothing without start', () => {
      useSelectionStore.getState().updateSelectionBox({ x: 50, y: 60 });
      expect(useSelectionStore.getState().selectionBox).toBeNull();
    });
  });

  describe('query methods', () => {
    it('isSelected returns correct boolean', () => {
      useSelectionStore.getState().select('el-1');
      expect(useSelectionStore.getState().isSelected('el-1')).toBe(true);
      expect(useSelectionStore.getState().isSelected('el-2')).toBe(false);
    });

    it('hasSelection returns true when elements selected', () => {
      expect(useSelectionStore.getState().hasSelection()).toBe(false);
      useSelectionStore.getState().select('el-1');
      expect(useSelectionStore.getState().hasSelection()).toBe(true);
    });

    it('getSelectedCount returns correct count', () => {
      expect(useSelectionStore.getState().getSelectedCount()).toBe(0);
      useSelectionStore.getState().selectMultiple(['el-1', 'el-2']);
      expect(useSelectionStore.getState().getSelectedCount()).toBe(2);
    });
  });
});

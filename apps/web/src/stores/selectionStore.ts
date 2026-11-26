import { create } from 'zustand';
import type { Point, Bounds } from '@mavisdraw/types';

interface SelectionState {
  selectedIds: Set<string>;
  /**
   * The selection once it has been stable for a moment. Contextual panels
   * use this so they don't pop up under the second click of a double-click.
   */
  settledSelectedIds: Set<string>;
  selectionBox: Bounds | null;
  hoveredId: string | null;

  // Internal tracking for rubber-band selection
  _selectionStart: Point | null;

  // Actions
  select: (id: string) => void;
  selectMultiple: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  toggleSelection: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  setHovered: (id: string | null) => void;

  // Selection box
  startSelectionBox: (point: Point) => void;
  updateSelectionBox: (point: Point) => void;
  endSelectionBox: () => Bounds | null;

  // Queries
  isSelected: (id: string) => boolean;
  hasSelection: () => boolean;
  getSelectedCount: () => number;
}

function computeBounds(start: Point, current: Point): Bounds {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const width = Math.abs(current.x - start.x);
  const height = Math.abs(current.y - start.y);
  return { x, y, width, height };
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedIds: new Set<string>(),
  settledSelectedIds: new Set<string>(),
  selectionBox: null,
  hoveredId: null,
  _selectionStart: null,

  select: (id: string) => {
    set({ selectedIds: new Set([id]) });
  },

  selectMultiple: (ids: string[]) => {
    set({ selectedIds: new Set(ids) });
  },

  addToSelection: (id: string) => {
    set((state) => {
      const next = new Set(state.selectedIds);
      next.add(id);
      return { selectedIds: next };
    });
  },

  removeFromSelection: (id: string) => {
    set((state) => {
      const next = new Set(state.selectedIds);
      next.delete(id);
      return { selectedIds: next };
    });
  },

  toggleSelection: (id: string) => {
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedIds: next };
    });
  },

  selectAll: (ids: string[]) => {
    set({ selectedIds: new Set(ids) });
  },

  clearSelection: () => {
    set({ selectedIds: new Set<string>(), selectionBox: null, _selectionStart: null });
  },

  setHovered: (id: string | null) => {
    set({ hoveredId: id });
  },

  startSelectionBox: (point: Point) => {
    set({
      _selectionStart: point,
      selectionBox: { x: point.x, y: point.y, width: 0, height: 0 },
    });
  },

  updateSelectionBox: (point: Point) => {
    const state = get();
    if (!state._selectionStart) return;

    const bounds = computeBounds(state._selectionStart, point);
    set({ selectionBox: bounds });
  },

  endSelectionBox: () => {
    const state = get();
    const box = state.selectionBox;
    set({ selectionBox: null, _selectionStart: null });
    return box;
  },

  isSelected: (id: string) => {
    return get().selectedIds.has(id);
  },

  hasSelection: () => {
    return get().selectedIds.size > 0;
  },

  getSelectedCount: () => {
    return get().selectedIds.size;
  },
}));

// ── Settled selection (debounced; clearing is immediate) ─────────────────
const SETTLE_MS = 250;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
useSelectionStore.subscribe((state, prev) => {
  if (state.selectedIds === prev.selectedIds) return;
  if (settleTimer) clearTimeout(settleTimer);
  if (state.selectedIds.size === 0) {
    useSelectionStore.setState({ settledSelectedIds: state.selectedIds });
    return;
  }
  settleTimer = setTimeout(() => {
    settleTimer = null;
    useSelectionStore.setState({ settledSelectedIds: useSelectionStore.getState().selectedIds });
  }, SETTLE_MS);
});

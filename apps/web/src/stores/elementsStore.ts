import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  MavisElement,
  ElementType,
  RenderMode,
  RectangleElement,
  EllipseElement,
  DiamondElement,
  TriangleElement,
  LinearElement,
  TextElement,
  PortalElement,
} from '@mavisdraw/types';

const MAX_HISTORY = 100;

const DEFAULT_STYLE = {
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'none' as const,
  strokeWidth: 2,
  strokeStyle: 'solid' as const,
  roughness: 1,
  renderMode: 'sketchy' as RenderMode,
  opacity: 100,
  angle: 0,
  layerId: 'default',
  groupIds: [] as string[],
  isLocked: false,
  isDeleted: false,
  boundElements: [] as { id: string; type: string }[],
  version: 1,
  updatedAt: Date.now(),
};

interface HistoryEntry {
  elements: Map<string, MavisElement>;
}

interface ElementsState {
  elements: Map<string, MavisElement>;

  // History for undo/redo
  history: HistoryEntry[];
  historyIndex: number;

  // CRUD operations
  addElement: (element: MavisElement) => void;
  updateElement: (id: string, updates: Partial<MavisElement>) => void;
  deleteElement: (id: string) => void;
  deleteElements: (ids: string[]) => void;

  // Bulk operations
  setElements: (elements: MavisElement[]) => void;

  // Query
  getElementById: (id: string) => MavisElement | undefined;
  getElementsByDiagram: (diagramId: string) => MavisElement[];
  getVisibleElements: (diagramId: string) => MavisElement[];

  // History
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Factory - create element with defaults
  createElement: (
    type: ElementType,
    diagramId: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => MavisElement;
}

function cloneElementsMap(
  map: Map<string, MavisElement>,
): Map<string, MavisElement> {
  const cloned = new Map<string, MavisElement>();
  for (const [key, value] of map) {
    cloned.set(key, { ...value });
  }
  return cloned;
}

export const useElementsStore = create<ElementsState>((set, get) => ({
  elements: new Map<string, MavisElement>(),
  history: [],
  historyIndex: -1,

  addElement: (element: MavisElement) => {
    const state = get();
    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);
      next.set(element.id, element);
      return { elements: next };
    });
  },

  updateElement: (id: string, updates: Partial<MavisElement>) => {
    const state = get();
    const existing = state.elements.get(id);
    if (!existing) return;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);
      const current = next.get(id);
      if (!current) return prev;
      next.set(id, {
        ...current,
        ...updates,
        version: current.version + 1,
        updatedAt: Date.now(),
      } as MavisElement);
      return { elements: next };
    });
  },

  deleteElement: (id: string) => {
    const state = get();
    if (!state.elements.has(id)) return;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);
      const element = next.get(id);
      if (element) {
        next.set(id, {
          ...element,
          isDeleted: true,
          version: element.version + 1,
          updatedAt: Date.now(),
        } as MavisElement);
      }
      return { elements: next };
    });
  },

  deleteElements: (ids: string[]) => {
    const state = get();
    const hasAny = ids.some((id) => state.elements.has(id));
    if (!hasAny) return;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);
      for (const id of ids) {
        const element = next.get(id);
        if (element) {
          next.set(id, {
            ...element,
            isDeleted: true,
            version: element.version + 1,
            updatedAt: Date.now(),
          } as MavisElement);
        }
      }
      return { elements: next };
    });
  },

  setElements: (elements: MavisElement[]) => {
    const map = new Map<string, MavisElement>();
    for (const el of elements) {
      map.set(el.id, el);
    }
    set({ elements: map, history: [], historyIndex: -1 });
  },

  getElementById: (id: string) => {
    return get().elements.get(id);
  },

  getElementsByDiagram: (diagramId: string) => {
    const results: MavisElement[] = [];
    for (const element of get().elements.values()) {
      if (element.diagramId === diagramId) {
        results.push(element);
      }
    }
    return results;
  },

  getVisibleElements: (diagramId: string) => {
    const results: MavisElement[] = [];
    for (const element of get().elements.values()) {
      if (element.diagramId === diagramId && !element.isDeleted) {
        results.push(element);
      }
    }
    return results;
  },

  pushHistory: () => {
    set((prev) => {
      // Discard any future entries beyond the current index
      const trimmed = prev.history.slice(0, prev.historyIndex + 1);

      // Snapshot current elements
      const snapshot: HistoryEntry = {
        elements: cloneElementsMap(prev.elements),
      };

      trimmed.push(snapshot);

      // Enforce max history size
      if (trimmed.length > MAX_HISTORY) {
        trimmed.shift();
      }

      return {
        history: trimmed,
        historyIndex: trimmed.length - 1,
      };
    });
  },

  undo: () => {
    const state = get();
    if (!state.canUndo()) return;

    const targetIndex = state.historyIndex;
    const entry = state.history[targetIndex];

    // Save current live state for redo if we're at the end of history
    let history = state.history;
    if (history.length === targetIndex + 1) {
      history = [...history, { elements: cloneElementsMap(state.elements) }];
    }

    set({
      elements: cloneElementsMap(entry.elements),
      historyIndex: targetIndex - 1,
      history,
    });
  },

  redo: () => {
    const state = get();
    if (!state.canRedo()) return;

    // history[i] is the pre-mutation snapshot for mutation i;
    // history[i+1] holds the post-mutation state saved by undo
    const entry = state.history[state.historyIndex + 2];

    set({
      elements: cloneElementsMap(entry.elements),
      historyIndex: state.historyIndex + 1,
    });
  },

  canUndo: () => {
    return get().historyIndex >= 0;
  },

  canRedo: () => {
    const state = get();
    return state.historyIndex + 2 < state.history.length;
  },

  createElement: (
    type: ElementType,
    diagramId: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): MavisElement => {
    const base = {
      id: nanoid(),
      diagramId,
      x,
      y,
      width,
      height,
      ...DEFAULT_STYLE,
      updatedAt: Date.now(),
    };

    switch (type) {
      case 'rectangle':
        return {
          ...base,
          type: 'rectangle',
          roundness: 0,
        } as RectangleElement;

      case 'ellipse':
        return {
          ...base,
          type: 'ellipse',
        } as EllipseElement;

      case 'diamond':
        return {
          ...base,
          type: 'diamond',
        } as DiamondElement;

      case 'triangle':
        return {
          ...base,
          type: 'triangle',
        } as TriangleElement;

      case 'line':
        return {
          ...base,
          type: 'line',
          points: [
            [0, 0],
            [width, height],
          ],
          startBinding: null,
          endBinding: null,
          routingMode: 'straight',
          startArrowhead: 'none',
          endArrowhead: 'none',
        } as LinearElement;

      case 'arrow':
        return {
          ...base,
          type: 'arrow',
          points: [
            [0, 0],
            [width, height],
          ],
          startBinding: null,
          endBinding: null,
          routingMode: 'straight',
          startArrowhead: 'none',
          endArrowhead: 'arrow',
        } as LinearElement;

      case 'freedraw':
        return {
          ...base,
          type: 'freedraw',
          points: [[0, 0]],
          startBinding: null,
          endBinding: null,
          routingMode: 'straight',
          startArrowhead: 'none',
          endArrowhead: 'none',
        } as LinearElement;

      case 'text':
        return {
          ...base,
          type: 'text',
          text: '',
          fontSize: 20,
          fontFamily: 'hand-drawn',
          textAlign: 'left',
          verticalAlign: 'top',
          containerId: null,
          lineHeight: 1.25,
          strokeWidth: 0,
        } as TextElement;

      case 'image':
        return {
          ...base,
          type: 'image',
          imageUrl: '',
          aspectRatio: width / (height || 1),
        } as MavisElement;

      case 'portal':
        return {
          ...base,
          type: 'portal',
          targetDiagramId: '',
          label: 'Portal',
          thumbnailDataUrl: null,
          portalStyle: 'card',
        } as PortalElement;

      default: {
        const _exhaustive: never = type;
        throw new Error(`Unknown element type: ${_exhaustive}`);
      }
    }
  },
}));

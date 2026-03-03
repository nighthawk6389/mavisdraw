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
  ImageElement,
  PortalElement,
  Point,
} from '@mavisdraw/types';

const MAX_HISTORY = 100;

const DEFAULT_STYLE = {
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'none' as const,
  strokeWidth: 2,
  strokeStyle: 'solid' as const,
  roughness: 1,
  seed: Math.floor(Math.random() * 2 ** 31),
  renderMode: 'clean' as RenderMode,
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

export type AlignmentType =
  | 'left'
  | 'center-horizontal'
  | 'right'
  | 'top'
  | 'center-vertical'
  | 'bottom';

export type DistributeDirection = 'horizontal' | 'vertical';

interface ClipboardData {
  elements: MavisElement[];
  sourceOffset: Point;
}

interface ElementsState {
  elements: Map<string, MavisElement>;

  // History for undo/redo
  history: HistoryEntry[];
  historyIndex: number;

  // Internal clipboard
  clipboard: ClipboardData | null;

  // CRUD operations
  addElement: (element: MavisElement) => void;
  updateElement: (id: string, updates: Partial<MavisElement>) => void;
  deleteElement: (id: string) => void;
  deleteElements: (ids: string[]) => void;

  // Bulk operations
  setElements: (elements: MavisElement[]) => void;
  updateElements: (updates: { id: string; changes: Partial<MavisElement> }[]) => void;

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

  // ── Arrow Binding ──────────────────────────────────────────

  /**
   * Bind an arrow endpoint to a shape.
   * Updates the arrow's startBinding/endBinding and the target shape's boundElements.
   */
  bindArrow: (
    arrowId: string,
    endpoint: 'start' | 'end',
    targetId: string,
    gap: number,
  ) => void;

  /**
   * Unbind an arrow endpoint from its current target.
   */
  unbindArrow: (arrowId: string, endpoint: 'start' | 'end') => void;

  /**
   * Move a shape and update all bound arrow endpoints.
   */
  moveElementWithBindings: (id: string, newX: number, newY: number) => void;

  // ── Text-in-Shape Binding ──────────────────────────────────

  /**
   * Create a text element bound inside a shape (container).
   */
  createBoundText: (containerId: string, text: string) => TextElement;

  // ── Grouping ───────────────────────────────────────────────

  /**
   * Group the given element IDs under a new groupId.
   */
  groupElements: (elementIds: string[]) => string;

  /**
   * Remove the outermost group from the given elements.
   */
  ungroupElements: (elementIds: string[]) => void;

  // ── Copy/Paste/Duplicate ────────────────────────────────────

  copyElements: (ids: string[]) => void;
  pasteElements: (diagramId: string) => MavisElement[];
  duplicateElements: (ids: string[]) => MavisElement[];

  // ── Alignment ──────────────────────────────────────────────

  alignElements: (ids: string[], alignment: AlignmentType) => void;
  distributeElements: (ids: string[], direction: DistributeDirection) => void;
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
  clipboard: null,

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

  updateElements: (updates: { id: string; changes: Partial<MavisElement> }[]) => {
    const state = get();
    const hasAny = updates.some((u) => state.elements.has(u.id));
    if (!hasAny) return;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);
      for (const { id, changes } of updates) {
        const current = next.get(id);
        if (current) {
          next.set(id, {
            ...current,
            ...changes,
            version: current.version + 1,
            updatedAt: Date.now(),
          } as MavisElement);
        }
      }
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
      seed: Math.floor(Math.random() * 2 ** 31),
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
        } as ImageElement;

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

  // ── Arrow Binding ──────────────────────────────────────────

  bindArrow: (
    arrowId: string,
    endpoint: 'start' | 'end',
    targetId: string,
    gap: number,
  ) => {
    const state = get();
    const arrow = state.elements.get(arrowId);
    const target = state.elements.get(targetId);
    if (!arrow || !target) return;
    if (arrow.type !== 'arrow' && arrow.type !== 'line') return;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);

      // Update arrow binding
      const currentArrow = next.get(arrowId) as LinearElement | undefined;
      if (!currentArrow) return prev;

      const bindingUpdate =
        endpoint === 'start'
          ? { startBinding: { elementId: targetId, gap } }
          : { endBinding: { elementId: targetId, gap } };

      next.set(arrowId, {
        ...currentArrow,
        ...bindingUpdate,
        version: currentArrow.version + 1,
        updatedAt: Date.now(),
      } as LinearElement);

      // Update target's boundElements
      const currentTarget = next.get(targetId);
      if (currentTarget) {
        const existing = currentTarget.boundElements.some((b) => b.id === arrowId);
        if (!existing) {
          next.set(targetId, {
            ...currentTarget,
            boundElements: [
              ...currentTarget.boundElements,
              { id: arrowId, type: 'arrow' },
            ],
            version: currentTarget.version + 1,
            updatedAt: Date.now(),
          } as MavisElement);
        }
      }

      return { elements: next };
    });
  },

  unbindArrow: (arrowId: string, endpoint: 'start' | 'end') => {
    const state = get();
    const arrow = state.elements.get(arrowId) as LinearElement | undefined;
    if (!arrow) return;

    const binding = endpoint === 'start' ? arrow.startBinding : arrow.endBinding;
    if (!binding) return;

    const targetId = binding.elementId;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);

      // Remove binding from arrow
      const currentArrow = next.get(arrowId) as LinearElement | undefined;
      if (!currentArrow) return prev;

      const bindingUpdate =
        endpoint === 'start'
          ? { startBinding: null }
          : { endBinding: null };

      next.set(arrowId, {
        ...currentArrow,
        ...bindingUpdate,
        version: currentArrow.version + 1,
        updatedAt: Date.now(),
      } as LinearElement);

      // Remove arrow from target's boundElements
      const currentTarget = next.get(targetId);
      if (currentTarget) {
        next.set(targetId, {
          ...currentTarget,
          boundElements: currentTarget.boundElements.filter((b) => b.id !== arrowId),
          version: currentTarget.version + 1,
          updatedAt: Date.now(),
        } as MavisElement);
      }

      return { elements: next };
    });
  },

  moveElementWithBindings: (id: string, newX: number, newY: number) => {
    const state = get();
    const element = state.elements.get(id);
    if (!element) return;

    set((prev) => {
      const next = new Map(prev.elements);

      // Move the element
      const current = next.get(id);
      if (!current) return prev;

      next.set(id, {
        ...current,
        x: newX,
        y: newY,
        version: current.version + 1,
        updatedAt: Date.now(),
      } as MavisElement);

      // Update bound arrows
      for (const bound of current.boundElements) {
        if (bound.type === 'arrow' || bound.type === 'line') {
          const arrow = next.get(bound.id) as LinearElement | undefined;
          if (!arrow || arrow.isDeleted) continue;

          const movedElement = next.get(id)!;
          const cx = movedElement.x + movedElement.width / 2;
          const cy = movedElement.y + movedElement.height / 2;

          const newPoints = [...arrow.points] as [number, number][];
          let updated = false;

          if (arrow.startBinding?.elementId === id) {
            // Update start point: compute direction from target center to arrow end
            const endPt: Point = {
              x: arrow.x + newPoints[newPoints.length - 1][0],
              y: arrow.y + newPoints[newPoints.length - 1][1],
            };
            const edgePt = getBindingEdgePoint(movedElement, endPt.x, endPt.y, arrow.startBinding.gap);
            newPoints[0] = [edgePt.x - arrow.x, edgePt.y - arrow.y];
            updated = true;
          }

          if (arrow.endBinding?.elementId === id) {
            // Update end point: compute direction from target center to arrow start
            const startPt: Point = {
              x: arrow.x + newPoints[0][0],
              y: arrow.y + newPoints[0][1],
            };
            const edgePt = getBindingEdgePoint(movedElement, startPt.x, startPt.y, arrow.endBinding.gap);
            newPoints[newPoints.length - 1] = [edgePt.x - arrow.x, edgePt.y - arrow.y];
            updated = true;
          }

          if (updated) {
            next.set(bound.id, {
              ...arrow,
              points: newPoints,
              version: arrow.version + 1,
              updatedAt: Date.now(),
            } as LinearElement);
          }
        }

        // Handle bound text (text-in-shape)
        if (bound.type === 'text') {
          const textEl = next.get(bound.id) as TextElement | undefined;
          if (!textEl || textEl.isDeleted) continue;

          const dx = newX - current.x;
          const dy = newY - current.y;

          next.set(bound.id, {
            ...textEl,
            x: textEl.x + dx,
            y: textEl.y + dy,
            version: textEl.version + 1,
            updatedAt: Date.now(),
          } as TextElement);
        }
      }

      return { elements: next };
    });
  },

  // ── Text-in-Shape Binding ──────────────────────────────────

  createBoundText: (containerId: string, text: string): TextElement => {
    const state = get();
    const container = state.elements.get(containerId);
    if (!container) throw new Error(`Container ${containerId} not found`);

    const padding = 10;
    const textEl: TextElement = {
      id: nanoid(),
      type: 'text',
      diagramId: container.diagramId,
      x: container.x + padding,
      y: container.y + padding,
      width: container.width - padding * 2,
      height: container.height - padding * 2,
      text,
      fontSize: 20,
      fontFamily: 'hand-drawn',
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId,
      lineHeight: 1.25,
      ...DEFAULT_STYLE,
      strokeWidth: 0,
      updatedAt: Date.now(),
    };

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);
      next.set(textEl.id, textEl);

      // Add to container's boundElements
      const currentContainer = next.get(containerId);
      if (currentContainer) {
        next.set(containerId, {
          ...currentContainer,
          boundElements: [
            ...currentContainer.boundElements,
            { id: textEl.id, type: 'text' },
          ],
          version: currentContainer.version + 1,
          updatedAt: Date.now(),
        } as MavisElement);
      }

      return { elements: next };
    });

    return textEl;
  },

  // ── Grouping ───────────────────────────────────────────────

  groupElements: (elementIds: string[]): string => {
    if (elementIds.length < 2) return '';

    const groupId = nanoid();
    const state = get();
    state.pushHistory();

    set((prev) => {
      const next = new Map(prev.elements);
      for (const id of elementIds) {
        const el = next.get(id);
        if (el && !el.isDeleted) {
          next.set(id, {
            ...el,
            groupIds: [groupId, ...el.groupIds],
            version: el.version + 1,
            updatedAt: Date.now(),
          } as MavisElement);
        }
      }
      return { elements: next };
    });

    return groupId;
  },

  ungroupElements: (elementIds: string[]) => {
    const state = get();

    // Find the outermost group shared by the selected elements
    const groupCounts = new Map<string, number>();
    for (const id of elementIds) {
      const el = state.elements.get(id);
      if (el && el.groupIds.length > 0) {
        const outermostGroup = el.groupIds[0];
        groupCounts.set(outermostGroup, (groupCounts.get(outermostGroup) || 0) + 1);
      }
    }

    if (groupCounts.size === 0) return;

    // Find the most common outermost group
    let targetGroupId = '';
    let maxCount = 0;
    for (const [gid, count] of groupCounts) {
      if (count > maxCount) {
        maxCount = count;
        targetGroupId = gid;
      }
    }

    if (!targetGroupId) return;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);
      // Remove the target group from ALL elements that have it
      for (const [id, el] of next) {
        if (el.groupIds.includes(targetGroupId)) {
          next.set(id, {
            ...el,
            groupIds: el.groupIds.filter((gid) => gid !== targetGroupId),
            version: el.version + 1,
            updatedAt: Date.now(),
          } as MavisElement);
        }
      }
      return { elements: next };
    });
  },

  // ── Copy/Paste/Duplicate ────────────────────────────────────

  copyElements: (ids: string[]) => {
    const state = get();
    const elementsToCopy: MavisElement[] = [];
    let minX = Infinity;
    let minY = Infinity;

    for (const id of ids) {
      const el = state.elements.get(id);
      if (el && !el.isDeleted) {
        elementsToCopy.push({ ...el });
        minX = Math.min(minX, el.x);
        minY = Math.min(minY, el.y);
      }
    }

    if (elementsToCopy.length === 0) return;

    set({
      clipboard: {
        elements: elementsToCopy,
        sourceOffset: { x: minX, y: minY },
      },
    });

    // Also copy to system clipboard as JSON
    try {
      const json = JSON.stringify({
        type: 'mavisdraw-clipboard',
        elements: elementsToCopy,
      });
      navigator.clipboard.writeText(json).catch(() => {
        // Silently fail if clipboard write is not available
      });
    } catch {
      // Ignore clipboard errors in non-browser environments
    }
  },

  pasteElements: (diagramId: string): MavisElement[] => {
    const state = get();
    const clipData = state.clipboard;
    if (!clipData || clipData.elements.length === 0) return [];

    const PASTE_OFFSET = 10;
    const idMap = new Map<string, string>();
    const groupIdMap = new Map<string, string>();
    const newElements: MavisElement[] = [];

    for (const original of clipData.elements) {
      const newId = nanoid();
      idMap.set(original.id, newId);

      // Map old group IDs to new ones
      const newGroupIds = original.groupIds.map((gid) => {
        if (!groupIdMap.has(gid)) {
          groupIdMap.set(gid, nanoid());
        }
        return groupIdMap.get(gid)!;
      });

      const newEl = {
        ...original,
        id: newId,
        diagramId,
        x: original.x + PASTE_OFFSET,
        y: original.y + PASTE_OFFSET,
        groupIds: newGroupIds,
        version: 1,
        updatedAt: Date.now(),
      } as MavisElement;

      newElements.push(newEl);
    }

    // Fix references in the pasted elements
    for (const el of newElements) {
      // Update boundElements references
      el.boundElements = el.boundElements
        .map((b) => ({
          id: idMap.get(b.id) || b.id,
          type: b.type,
        }))
        .filter((b) => idMap.has(b.id) || !clipData.elements.some((orig) => orig.id === b.id));

      // Update arrow bindings
      if (el.type === 'arrow' || el.type === 'line' || el.type === 'freedraw') {
        const linear = el as LinearElement;
        if (linear.startBinding) {
          const newTargetId = idMap.get(linear.startBinding.elementId);
          if (newTargetId) {
            (el as LinearElement).startBinding = {
              ...linear.startBinding,
              elementId: newTargetId,
            };
          } else {
            (el as LinearElement).startBinding = null;
          }
        }
        if (linear.endBinding) {
          const newTargetId = idMap.get(linear.endBinding.elementId);
          if (newTargetId) {
            (el as LinearElement).endBinding = {
              ...linear.endBinding,
              elementId: newTargetId,
            };
          } else {
            (el as LinearElement).endBinding = null;
          }
        }
      }

      // Update text containerId
      if (el.type === 'text') {
        const textEl = el as TextElement;
        if (textEl.containerId) {
          const newContainerId = idMap.get(textEl.containerId);
          (el as TextElement).containerId = newContainerId || null;
        }
      }
    }

    // Add all new elements to the store
    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);
      for (const el of newElements) {
        next.set(el.id, el);
      }
      return { elements: next };
    });

    return newElements;
  },

  duplicateElements: (ids: string[]): MavisElement[] => {
    const state = get();
    // Use copy then paste logic, but internally
    state.copyElements(ids);
    const currentState = get();
    if (!currentState.clipboard || currentState.clipboard.elements.length === 0) return [];

    const diagramId = currentState.clipboard.elements[0].diagramId;
    return state.pasteElements(diagramId);
  },

  // ── Alignment ──────────────────────────────────────────────

  alignElements: (ids: string[], alignment: AlignmentType) => {
    const state = get();
    if (ids.length < 2) return;

    const elems = ids
      .map((id) => state.elements.get(id))
      .filter((el): el is MavisElement => el !== undefined && !el.isDeleted);

    if (elems.length < 2) return;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);

      // Compute reference values
      let refValue: number;
      switch (alignment) {
        case 'left':
          refValue = Math.min(...elems.map((e) => e.x));
          for (const el of elems) {
            const current = next.get(el.id)!;
            next.set(el.id, {
              ...current,
              x: refValue,
              version: current.version + 1,
              updatedAt: Date.now(),
            } as MavisElement);
          }
          break;

        case 'center-horizontal':
          refValue =
            (Math.min(...elems.map((e) => e.x)) +
              Math.max(...elems.map((e) => e.x + e.width))) /
            2;
          for (const el of elems) {
            const current = next.get(el.id)!;
            next.set(el.id, {
              ...current,
              x: refValue - current.width / 2,
              version: current.version + 1,
              updatedAt: Date.now(),
            } as MavisElement);
          }
          break;

        case 'right':
          refValue = Math.max(...elems.map((e) => e.x + e.width));
          for (const el of elems) {
            const current = next.get(el.id)!;
            next.set(el.id, {
              ...current,
              x: refValue - current.width,
              version: current.version + 1,
              updatedAt: Date.now(),
            } as MavisElement);
          }
          break;

        case 'top':
          refValue = Math.min(...elems.map((e) => e.y));
          for (const el of elems) {
            const current = next.get(el.id)!;
            next.set(el.id, {
              ...current,
              y: refValue,
              version: current.version + 1,
              updatedAt: Date.now(),
            } as MavisElement);
          }
          break;

        case 'center-vertical':
          refValue =
            (Math.min(...elems.map((e) => e.y)) +
              Math.max(...elems.map((e) => e.y + e.height))) /
            2;
          for (const el of elems) {
            const current = next.get(el.id)!;
            next.set(el.id, {
              ...current,
              y: refValue - current.height / 2,
              version: current.version + 1,
              updatedAt: Date.now(),
            } as MavisElement);
          }
          break;

        case 'bottom':
          refValue = Math.max(...elems.map((e) => e.y + e.height));
          for (const el of elems) {
            const current = next.get(el.id)!;
            next.set(el.id, {
              ...current,
              y: refValue - current.height,
              version: current.version + 1,
              updatedAt: Date.now(),
            } as MavisElement);
          }
          break;
      }

      return { elements: next };
    });
  },

  distributeElements: (ids: string[], direction: DistributeDirection) => {
    const state = get();
    if (ids.length < 3) return;

    const elems = ids
      .map((id) => state.elements.get(id))
      .filter((el): el is MavisElement => el !== undefined && !el.isDeleted);

    if (elems.length < 3) return;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);

      if (direction === 'horizontal') {
        // Sort by x position
        const sorted = [...elems].sort((a, b) => a.x - b.x);
        const firstX = sorted[0].x;
        const lastX = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width;
        const totalWidth = sorted.reduce((sum, el) => sum + el.width, 0);
        const totalGap = (lastX - firstX - totalWidth) / (sorted.length - 1);

        let currentX = sorted[0].x + sorted[0].width + totalGap;
        for (let i = 1; i < sorted.length - 1; i++) {
          const current = next.get(sorted[i].id)!;
          next.set(sorted[i].id, {
            ...current,
            x: currentX,
            version: current.version + 1,
            updatedAt: Date.now(),
          } as MavisElement);
          currentX += sorted[i].width + totalGap;
        }
      } else {
        // Sort by y position
        const sorted = [...elems].sort((a, b) => a.y - b.y);
        const firstY = sorted[0].y;
        const lastY = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height;
        const totalHeight = sorted.reduce((sum, el) => sum + el.height, 0);
        const totalGap = (lastY - firstY - totalHeight) / (sorted.length - 1);

        let currentY = sorted[0].y + sorted[0].height + totalGap;
        for (let i = 1; i < sorted.length - 1; i++) {
          const current = next.get(sorted[i].id)!;
          next.set(sorted[i].id, {
            ...current,
            y: currentY,
            version: current.version + 1,
            updatedAt: Date.now(),
          } as MavisElement);
          currentY += sorted[i].height + totalGap;
        }
      }

      return { elements: next };
    });
  },
}));

// ── Helper functions ──────────────────────────────────────────

/**
 * Get the point on an element's edge closest to a given point.
 * Used for computing arrow binding positions.
 */
function getBindingEdgePoint(
  element: MavisElement,
  fromX: number,
  fromY: number,
  gap: number,
): Point {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const angle = Math.atan2(fromY - cy, fromX - cx);

  switch (element.type) {
    case 'ellipse': {
      const rx = element.width / 2 + gap;
      const ry = element.height / 2 + gap;
      return {
        x: cx + rx * Math.cos(angle),
        y: cy + ry * Math.sin(angle),
      };
    }

    case 'diamond': {
      const hw = element.width / 2 + gap;
      const hh = element.height / 2 + gap;
      const cosA = Math.abs(Math.cos(angle));
      const sinA = Math.abs(Math.sin(angle));
      const denom = cosA / hw + sinA / hh;
      if (denom === 0) return { x: cx, y: cy };
      const r = 1 / denom;
      return {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      };
    }

    default: {
      const hw = element.width / 2 + gap;
      const hh = element.height / 2 + gap;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      if (cosA === 0) {
        return { x: cx, y: cy + (sinA > 0 ? hh : -hh) };
      }
      if (sinA === 0) {
        return { x: cx + (cosA > 0 ? hw : -hw), y: cy };
      }

      const tx = hw / Math.abs(cosA);
      const ty = hh / Math.abs(sinA);
      const t = Math.min(tx, ty);

      return {
        x: cx + t * cosA,
        y: cy + t * sinA,
      };
    }
  }
}

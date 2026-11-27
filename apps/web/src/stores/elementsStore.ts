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
import { useLayerStore } from './layerStore';
import {
  BOUND_TEXT_PADDING,
  boundTextBox,
  isLinear,
  cascadeDelete,
  reglueArrowEndpoints,
  syncBoundElements,
  withBoundLabels,
} from './elementBindings';
import {
  type HistoryEntry,
  COALESCE_WINDOW_MS,
  MAX_HISTORY,
  applyValues,
  createEntry,
  diffElementMaps,
  isNoopEntry,
  recordChange,
} from './history';

export { getBindingEdgePoint } from './elementBindings';
export type { HistoryEntry } from './history';

/**
 * Clamp a bound text element's position and size so its box stays inside the container.
 * Returns clamped { x, y, width, height }.
 */
function clampBoundTextToContainer(
  textX: number,
  textY: number,
  textW: number,
  textH: number,
  container: MavisElement,
): { x: number; y: number; width: number; height: number } {
  const minX = container.x + BOUND_TEXT_PADDING;
  const minY = container.y + BOUND_TEXT_PADDING;
  const maxW = Math.max(20, container.width - BOUND_TEXT_PADDING * 2);
  const maxH = Math.max(20, container.height - BOUND_TEXT_PADDING * 2);
  const width = Math.max(20, Math.min(textW, maxW));
  const height = Math.max(20, Math.min(textH, maxH));
  const x = Math.max(minX, Math.min(textX, minX + maxW - width));
  const y = Math.max(minY, Math.min(textY, minY + maxH - height));
  return { x, y, width, height };
}

function getElementBounds(el: MavisElement): { minX: number; minY: number; maxX: number; maxY: number } {
  if (el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw') {
    const pts = el.points;
    if (pts.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [px, py] of pts) {
        const wx = el.x + px;
        const wy = el.y + py;
        if (wx < minX) minX = wx;
        if (wy < minY) minY = wy;
        if (wx > maxX) maxX = wx;
        if (wy > maxY) maxY = wy;
      }
      return { minX, minY, maxX, maxY };
    }
  }
  return { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height };
}

function getElWidth(el: MavisElement): number {
  const b = getElementBounds(el);
  return b.maxX - b.minX;
}

function getElHeight(el: MavisElement): number {
  const b = getElementBounds(el);
  return b.maxY - b.minY;
}

/** Shift an element so its visual minX becomes newMinX. */
function setMinX(el: MavisElement, next: Map<string, MavisElement>, newMinX: number) {
  const b = getElementBounds(el);
  const dx = newMinX - b.minX;
  const current = next.get(el.id)!;
  next.set(el.id, {
    ...current,
    x: current.x + dx,
    version: current.version + 1,
    updatedAt: Date.now(),
  } as MavisElement);
}

function setMinY(el: MavisElement, next: Map<string, MavisElement>, newMinY: number) {
  const b = getElementBounds(el);
  const dy = newMinY - b.minY;
  const current = next.get(el.id)!;
  next.set(el.id, {
    ...current,
    y: current.y + dy,
    version: current.version + 1,
    updatedAt: Date.now(),
  } as MavisElement);
}

/**
 * Stacking value for new elements: increases monotonically and is unique per
 * client without coordination, so newly drawn shapes land on top for every
 * collaborator. Stays below 2^53.
 */
let zCounter = 0;
export function nextZIndex(): number {
  zCounter = (zCounter + 1) % 1000;
  return Date.now() * 1000 + zCounter;
}

const DEFAULT_STYLE = {
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'none' as const,
  strokeWidth: 2,
  strokeStyle: 'solid' as const,
  roughness: 1,
  renderMode: 'clean' as RenderMode,
  opacity: 100,
  angle: 0,
  layerId: 'default',
  groupIds: [] as string[],
  isLocked: false,
  isDeleted: false,
  boundElements: [] as { id: string; type: string }[],
  version: 1,
};

function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function activeLayerId(): string {
  try {
    return useLayerStore.getState().activeLayerId || 'default';
  } catch {
    return 'default';
  }
}

export type AlignmentType =
  | 'left'
  | 'center-horizontal'
  | 'right'
  | 'top'
  | 'center-vertical'
  | 'bottom';

export type DistributeDirection = 'horizontal' | 'vertical';

export type ZOrderAction = 'front' | 'forward' | 'backward' | 'back';

interface ClipboardData {
  elements: MavisElement[];
  sourceOffset: Point;
}

/** JSON envelope written to the system clipboard (cross-tab paste). */
export interface ClipboardEnvelope {
  type: 'mavisdraw-clipboard';
  elements: MavisElement[];
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
  /** Update without pushing history — use when caller already pushed history (e.g. drag/resize). */
  updateElementSilent: (id: string, updates: Partial<MavisElement>) => void;
  deleteElement: (id: string) => void;
  deleteElements: (ids: string[]) => void;
  /** Remove elements from the map entirely (for never-committed drafts). */
  discardElements: (ids: string[]) => void;

  // Bulk operations
  setElements: (elements: MavisElement[]) => void;
  updateElements: (updates: { id: string; changes: Partial<MavisElement> }[]) => void;
  /**
   * Apply many updates as one store change, without opening an undo step —
   * for pointer gestures (drag, resize) that already run inside a history
   * batch. One Map copy and one change notification per call, however many
   * elements move. Labels stay inside their shapes and bound arrows stay
   * attached, including arrows that move while their target stays put.
   */
  updateElementsSilent: (updates: { id: string; changes: Partial<MavisElement> }[]) => void;

  // Query
  getElementById: (id: string) => MavisElement | undefined;
  getElementsByDiagram: (diagramId: string) => MavisElement[];
  getVisibleElements: (diagramId: string) => MavisElement[];

  // History
  undo: () => void;
  redo: () => void;
  /**
   * Start a new undo step. Pushes with the same `coalesceKey` within a short
   * window share one step (e.g. dragging a slider).
   */
  pushHistory: (coalesceKey?: string) => void;
  /** Group everything until `endHistoryBatch` into a single undo step. */
  beginHistoryBatch: () => void;
  endHistoryBatch: () => void;
  /** Run `fn` with its changes appended to the most recent undo step. */
  amendLastHistoryEntry: (fn: () => void) => void;
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
   * Move an element and keep its label and bound arrows attached.
   * Does not push history: the caller owns the gesture's undo step.
   */
  moveElementWithBindings: (id: string, newX: number, newY: number) => void;

  // ── Text-in-Shape Binding ──────────────────────────────────

  /**
   * Create a text element bound inside a shape (container).
   */
  createBoundText: (containerId: string, text: string) => TextElement;

  // ── Grouping ───────────────────────────────────────────────

  groupElements: (elementIds: string[]) => string;
  ungroupElements: (elementIds: string[]) => void;

  // ── Copy/Paste/Duplicate ────────────────────────────────────

  copyElements: (ids: string[]) => ClipboardEnvelope | null;
  /** Paste the internal clipboard. With `at`, the pasted group is centered there. */
  pasteElements: (diagramId: string, at?: Point, offset?: Point) => MavisElement[];
  /** Load elements from a system-clipboard envelope into the internal clipboard. */
  setClipboardFromEnvelope: (envelope: ClipboardEnvelope) => void;
  /** Copy elements (with their labels) offset by `offset` (default 10, 10). */
  duplicateElements: (ids: string[], offset?: Point) => MavisElement[];

  // ── Alignment ──────────────────────────────────────────────

  alignElements: (ids: string[], alignment: AlignmentType) => void;
  distributeElements: (ids: string[], direction: DistributeDirection) => void;

  // ── Stacking & locking ─────────────────────────────────────

  reorderElements: (ids: string[], action: ZOrderAction) => void;
  setElementsLocked: (ids: string[], locked: boolean) => void;
}

// ── History recording state (module-level, never rendered) ─────────────
/** >0 while applying changes that must not be undoable (remote, loads). */
let unrecordedDepth = 0;
/** >0 while a gesture batch is open: pushHistory() calls are absorbed. */
let batchDepth = 0;

/**
 * Apply changes that should never be undone by the local user: edits that
 * arrive from collaborators, server loads, thumbnail refreshes.
 */
export function withoutHistory<T>(fn: () => T): T {
  unrecordedDepth += 1;
  try {
    return fn();
  } finally {
    unrecordedDepth -= 1;
  }
}

/** Alias used by the collaboration layer for readability. */
export const applyRemoteChanges = withoutHistory;

/** True while applying changes that aren't the local user's edits (remote, loads). */
export function isApplyingUnrecorded(): boolean {
  return unrecordedDepth > 0;
}

/** Shared logic for updating a single element (keeps labels and arrows attached). */
function applyElementUpdate(
  set: (fn: (prev: ElementsState) => Partial<ElementsState>) => void,
  id: string,
  updates: Partial<MavisElement>,
) {
  set((prev) => {
    const next = new Map(prev.elements);
    const current = next.get(id);
    if (!current) return prev;

    const merged = {
      ...current,
      ...updates,
      version: current.version + 1,
      updatedAt: Date.now(),
    } as MavisElement;

    // Keep bound text inside its container (connector labels re-centre instead)
    let containerToSync: string | null = null;
    if (merged.type === 'text' && merged.containerId) {
      const container = next.get(merged.containerId);
      if (container && !container.isDeleted) {
        if (isLinear(container)) {
          containerToSync = container.id;
        } else {
          Object.assign(
            merged,
            clampBoundTextToContainer(merged.x, merged.y, merged.width, merged.height, container),
          );
        }
      }
    }

    next.set(id, merged);
    syncBoundElements(next, id);
    if (containerToSync) syncBoundElements(next, containerToSync);

    return { elements: next };
  });
}

export const useElementsStore = create<ElementsState>((set, get) => ({
  elements: new Map<string, MavisElement>(),
  history: [],
  historyIndex: -1,
  clipboard: null,

  addElement: (element: MavisElement) => {
    get().pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);
      next.set(element.id, element);
      return { elements: next };
    });
  },

  updateElement: (id: string, updates: Partial<MavisElement>) => {
    const state = get();
    if (!state.elements.has(id)) return;
    state.pushHistory();
    applyElementUpdate(set, id, updates);
  },

  updateElementSilent: (id: string, updates: Partial<MavisElement>) => {
    if (!get().elements.has(id)) return;
    applyElementUpdate(set, id, updates);
  },

  updateElementsSilent: (updates: { id: string; changes: Partial<MavisElement> }[]) => {
    const state = get();
    if (!updates.some((u) => state.elements.has(u.id))) return;
    set((prev) => {
      const next = new Map(prev.elements);
      const now = Date.now();
      const changed: string[] = [];
      for (const { id, changes } of updates) {
        const current = next.get(id);
        if (!current) continue;
        next.set(id, {
          ...current,
          ...changes,
          version: current.version + 1,
          updatedAt: now,
        } as MavisElement);
        changed.push(id);
      }
      for (const id of changed) {
        const el = next.get(id)!;
        // A label moved on its own stays inside its shape
        if (el.type === 'text' && el.containerId) {
          const container = next.get(el.containerId);
          if (container && !container.isDeleted && !isLinear(container)) {
            next.set(id, {
              ...el,
              ...clampBoundTextToContainer(el.x, el.y, el.width, el.height, container),
            } as MavisElement);
          }
        }
      }
      for (const id of changed) syncBoundElements(next, id);
      for (const id of changed) reglueArrowEndpoints(next, id);
      return { elements: next };
    });
  },

  updateElements: (updates: { id: string; changes: Partial<MavisElement> }[]) => {
    const state = get();
    if (!updates.some((u) => state.elements.has(u.id))) return;

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
      for (const { id } of updates) syncBoundElements(next, id);
      return { elements: next };
    });
  },

  deleteElement: (id: string) => {
    get().deleteElements([id]);
  },

  deleteElements: (ids: string[]) => {
    const state = get();
    if (!ids.some((id) => state.elements.has(id))) return;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);
      const deleted = cascadeDelete(next, ids);
      return deleted.size > 0 ? { elements: next } : prev;
    });
  },

  discardElements: (ids: string[]) => {
    set((prev) => {
      const next = new Map(prev.elements);
      let changed = false;
      for (const id of ids) {
        const el = next.get(id);
        if (!el) continue;
        next.delete(id);
        changed = true;
        // Drop back-references from the label's container
        if (el.type === 'text' && el.containerId) {
          const container = next.get(el.containerId);
          if (container) {
            next.set(container.id, {
              ...container,
              boundElements: container.boundElements.filter((b) => b.id !== id),
              version: container.version + 1,
              updatedAt: Date.now(),
            } as MavisElement);
          }
        }
      }
      return changed ? { elements: next } : prev;
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

  // ── History ──────────────────────────────────────────────────

  pushHistory: (coalesceKey?: string) => {
    if (batchDepth > 0) return;
    const { history, historyIndex } = get();
    const now = Date.now();
    const top = historyIndex >= 0 ? history[historyIndex] : undefined;
    const atEnd = historyIndex === history.length - 1;

    // Reuse an empty step (e.g. a click that didn't change anything)
    if (top && atEnd && top.before.size === 0) {
      top.key = coalesceKey;
      top.time = now;
      return;
    }

    // Coalesce rapid repeated changes of the same kind into one step
    if (coalesceKey && top && atEnd && top.key === coalesceKey && now - top.time < COALESCE_WINDOW_MS) {
      top.time = now;
      return;
    }

    const trimmed = history.slice(0, historyIndex + 1);
    trimmed.push(createEntry(coalesceKey, now));
    if (trimmed.length > MAX_HISTORY) trimmed.shift();
    set({ history: trimmed, historyIndex: trimmed.length - 1 });
  },

  beginHistoryBatch: () => {
    if (batchDepth === 0) get().pushHistory();
    batchDepth += 1;
  },

  endHistoryBatch: () => {
    batchDepth = Math.max(0, batchDepth - 1);
  },

  amendLastHistoryEntry: (fn: () => void) => {
    const { history, historyIndex } = get();
    if (historyIndex < 0 || historyIndex !== history.length - 1) {
      fn();
      return;
    }
    batchDepth += 1;
    try {
      fn();
    } finally {
      batchDepth -= 1;
    }
  },

  undo: () => {
    const { history, historyIndex } = get();
    let idx = historyIndex;
    while (idx >= 0 && isNoopEntry(history[idx])) idx--;
    if (idx < 0) {
      if (historyIndex >= 0) set({ historyIndex: -1 });
      return;
    }
    const entry = history[idx];
    set((prev) => {
      const next = new Map(prev.elements);
      applyValues(next, entry.before, entry.after);
      return { elements: next, historyIndex: idx - 1 };
    });
  },

  redo: () => {
    const { history, historyIndex } = get();
    let idx = historyIndex + 1;
    while (idx < history.length && isNoopEntry(history[idx])) idx++;
    if (idx >= history.length) return;
    const entry = history[idx];
    set((prev) => {
      const next = new Map(prev.elements);
      applyValues(next, entry.after, entry.before);
      return { elements: next, historyIndex: idx };
    });
  },

  canUndo: () => {
    const { history, historyIndex } = get();
    for (let i = historyIndex; i >= 0; i--) {
      if (!isNoopEntry(history[i])) return true;
    }
    return false;
  },

  canRedo: () => {
    const { history, historyIndex } = get();
    for (let i = historyIndex + 1; i < history.length; i++) {
      if (!isNoopEntry(history[i])) return true;
    }
    return false;
  },

  createElement: (
    type: ElementType,
    diagramId: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): MavisElement => {
    const now = Date.now();
    const base = {
      id: nanoid(),
      diagramId,
      x,
      y,
      width,
      height,
      ...DEFAULT_STYLE,
      seed: newSeed(),
      layerId: activeLayerId(),
      zIndex: nextZIndex(),
      updatedAt: now,
    };

    switch (type) {
      case 'rectangle':
        return { ...base, type: 'rectangle', roundness: 0 } as RectangleElement;

      case 'ellipse':
        return { ...base, type: 'ellipse' } as EllipseElement;

      case 'diamond':
        return { ...base, type: 'diamond' } as DiamondElement;

      case 'triangle':
        return { ...base, type: 'triangle' } as TriangleElement;

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
          githubLink: null,
        } as PortalElement;

      default: {
        const _exhaustive: never = type;
        throw new Error(`Unknown element type: ${_exhaustive}`);
      }
    }
  },

  // ── Arrow Binding ──────────────────────────────────────────

  bindArrow: (arrowId: string, endpoint: 'start' | 'end', targetId: string, gap: number) => {
    const state = get();
    const arrow = state.elements.get(arrowId);
    const target = state.elements.get(targetId);
    if (!arrow || !target) return;
    if (arrow.type !== 'arrow' && arrow.type !== 'line') return;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);

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

      const currentTarget = next.get(targetId);
      if (currentTarget && !currentTarget.boundElements.some((b) => b.id === arrowId)) {
        next.set(targetId, {
          ...currentTarget,
          boundElements: [...currentTarget.boundElements, { id: arrowId, type: 'arrow' }],
          version: currentTarget.version + 1,
          updatedAt: Date.now(),
        } as MavisElement);
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
    const otherBinding = endpoint === 'start' ? arrow.endBinding : arrow.startBinding;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);

      const currentArrow = next.get(arrowId) as LinearElement | undefined;
      if (!currentArrow) return prev;

      next.set(arrowId, {
        ...currentArrow,
        ...(endpoint === 'start' ? { startBinding: null } : { endBinding: null }),
        version: currentArrow.version + 1,
        updatedAt: Date.now(),
      } as LinearElement);

      // Keep the back-reference if the other end is bound to the same shape
      const currentTarget = next.get(targetId);
      if (currentTarget && otherBinding?.elementId !== targetId) {
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
    if (!get().elements.has(id)) return;

    set((prev) => {
      const next = new Map(prev.elements);
      const current = next.get(id);
      if (!current) return prev;

      let finalX = newX;
      let finalY = newY;
      // Keep bound text inside its container when moving the text itself
      if (current.type === 'text' && current.containerId) {
        const container = next.get(current.containerId);
        if (container && !container.isDeleted) {
          const clamped = clampBoundTextToContainer(
            newX,
            newY,
            current.width,
            current.height,
            container,
          );
          finalX = clamped.x;
          finalY = clamped.y;
        }
      }

      next.set(id, {
        ...current,
        x: finalX,
        y: finalY,
        version: current.version + 1,
        updatedAt: Date.now(),
      } as MavisElement);

      syncBoundElements(next, id);
      return { elements: next };
    });
  },

  // ── Text-in-Shape Binding ──────────────────────────────────

  createBoundText: (containerId: string, text: string): TextElement => {
    const state = get();
    const container = state.elements.get(containerId);
    if (!container) throw new Error(`Container ${containerId} not found`);

    const connector = isLinear(container);
    const textEl: TextElement = {
      id: nanoid(),
      type: 'text',
      diagramId: container.diagramId,
      ...boundTextBox(container),
      text,
      fontSize: connector ? 16 : 20,
      fontFamily: 'hand-drawn',
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId,
      lineHeight: 1.25,
      ...DEFAULT_STYLE,
      seed: newSeed(),
      layerId: container.layerId,
      zIndex: container.zIndex,
      strokeWidth: 0,
      updatedAt: Date.now(),
    };

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);
      next.set(textEl.id, textEl);

      const currentContainer = next.get(containerId);
      if (currentContainer) {
        next.set(containerId, {
          ...currentContainer,
          boundElements: [...currentContainer.boundElements, { id: textEl.id, type: 'text' }],
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
    get().pushHistory();

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

    const groupCounts = new Map<string, number>();
    for (const id of elementIds) {
      const el = state.elements.get(id);
      if (el && el.groupIds.length > 0) {
        const outermostGroup = el.groupIds[0];
        groupCounts.set(outermostGroup, (groupCounts.get(outermostGroup) || 0) + 1);
      }
    }

    if (groupCounts.size === 0) return;

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

  copyElements: (ids: string[]): ClipboardEnvelope | null => {
    const state = get();
    const elementsToCopy: MavisElement[] = [];
    let minX = Infinity;
    let minY = Infinity;

    // Labels travel with their shapes
    for (const id of withBoundLabels(state.elements, ids)) {
      const el = state.elements.get(id);
      if (el && !el.isDeleted) {
        elementsToCopy.push({ ...el });
        minX = Math.min(minX, el.x);
        minY = Math.min(minY, el.y);
      }
    }

    if (elementsToCopy.length === 0) return null;

    set({
      clipboard: {
        elements: elementsToCopy,
        sourceOffset: { x: minX, y: minY },
      },
    });

    return { type: 'mavisdraw-clipboard', elements: elementsToCopy };
  },

  setClipboardFromEnvelope: (envelope: ClipboardEnvelope) => {
    const elements = envelope.elements.filter((el) => el && typeof el.id === 'string');
    if (elements.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    for (const el of elements) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
    }
    set({ clipboard: { elements, sourceOffset: { x: minX, y: minY } } });
  },

  pasteElements: (diagramId: string, at?: Point, offset?: Point): MavisElement[] => {
    const state = get();
    const clipData = state.clipboard;
    if (!clipData || clipData.elements.length === 0) return [];

    // Where to put the pasted group: centered on `at`, or nudged from the source
    let dx = offset?.x ?? 10;
    let dy = offset?.y ?? 10;
    if (at) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const el of clipData.elements) {
        const b = getElementBounds(el);
        minX = Math.min(minX, b.minX);
        minY = Math.min(minY, b.minY);
        maxX = Math.max(maxX, b.maxX);
        maxY = Math.max(maxY, b.maxY);
      }
      dx = at.x - (minX + maxX) / 2;
      dy = at.y - (minY + maxY) / 2;
    }

    const idMap = new Map<string, string>();
    const groupIdMap = new Map<string, string>();
    for (const original of clipData.elements) {
      idMap.set(original.id, nanoid());
    }

    // Keep relative stacking but land on top of existing content
    const sortedByZ = [...clipData.elements].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    const zFor = new Map<string, number>();
    for (const el of sortedByZ) zFor.set(el.id, nextZIndex());

    const newElements: MavisElement[] = clipData.elements.map((original) => {
      const newGroupIds = original.groupIds.map((gid) => {
        if (!groupIdMap.has(gid)) groupIdMap.set(gid, nanoid());
        return groupIdMap.get(gid)!;
      });

      const el = {
        ...original,
        id: idMap.get(original.id)!,
        diagramId,
        x: original.x + dx,
        y: original.y + dy,
        groupIds: newGroupIds,
        isDeleted: false,
        isLocked: false,
        zIndex: zFor.get(original.id),
        version: 1,
        updatedAt: Date.now(),
        // Only references to elements that were pasted along survive
        boundElements: original.boundElements
          .filter((b) => idMap.has(b.id))
          .map((b) => ({ id: idMap.get(b.id)!, type: b.type })),
      } as MavisElement;

      if (el.type === 'arrow' || el.type === 'line' || el.type === 'freedraw') {
        const start = el.startBinding ? idMap.get(el.startBinding.elementId) : undefined;
        const end = el.endBinding ? idMap.get(el.endBinding.elementId) : undefined;
        el.startBinding = start && el.startBinding ? { ...el.startBinding, elementId: start } : null;
        el.endBinding = end && el.endBinding ? { ...el.endBinding, elementId: end } : null;
      }

      if (el.type === 'text' && el.containerId) {
        el.containerId = idMap.get(el.containerId) ?? null;
      }

      if (el.type === 'portal') {
        // A pasted portal is a new door; it doesn't share the original's child diagram
        el.targetDiagramId = '';
      }

      return el;
    });

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

  duplicateElements: (ids: string[], offset?: Point): MavisElement[] => {
    const state = get();
    const previousClipboard = state.clipboard;
    const envelope = state.copyElements(ids);
    if (!envelope) return [];
    const diagramId = envelope.elements[0].diagramId;
    const pasted = get().pasteElements(diagramId, undefined, offset);
    // Duplicating shouldn't clobber what the user copied
    set({ clipboard: previousClipboard });
    return pasted;
  },

  // ── Alignment ──────────────────────────────────────────────

  alignElements: (ids: string[], alignment: AlignmentType) => {
    const state = get();
    if (ids.length < 2) return;

    const elems = ids
      .map((id) => state.elements.get(id))
      .filter((el): el is MavisElement => el !== undefined && !el.isDeleted && !el.isLocked);

    if (elems.length < 2) return;

    const bounds = elems.map((e) => ({ el: e, b: getElementBounds(e) }));

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);

      switch (alignment) {
        case 'left': {
          const ref = Math.min(...bounds.map((e) => e.b.minX));
          for (const { el } of bounds) setMinX(el, next, ref);
          break;
        }
        case 'center-horizontal': {
          const ref = (Math.min(...bounds.map((e) => e.b.minX)) + Math.max(...bounds.map((e) => e.b.maxX))) / 2;
          for (const { el } of bounds) setMinX(el, next, ref - getElWidth(el) / 2);
          break;
        }
        case 'right': {
          const ref = Math.max(...bounds.map((e) => e.b.maxX));
          for (const { el } of bounds) setMinX(el, next, ref - getElWidth(el));
          break;
        }
        case 'top': {
          const ref = Math.min(...bounds.map((e) => e.b.minY));
          for (const { el } of bounds) setMinY(el, next, ref);
          break;
        }
        case 'center-vertical': {
          const ref = (Math.min(...bounds.map((e) => e.b.minY)) + Math.max(...bounds.map((e) => e.b.maxY))) / 2;
          for (const { el } of bounds) setMinY(el, next, ref - getElHeight(el) / 2);
          break;
        }
        case 'bottom': {
          const ref = Math.max(...bounds.map((e) => e.b.maxY));
          for (const { el } of bounds) setMinY(el, next, ref - getElHeight(el));
          break;
        }
      }

      for (const { el } of bounds) syncBoundElements(next, el.id);
      return { elements: next };
    });
  },

  distributeElements: (ids: string[], direction: DistributeDirection) => {
    const state = get();
    if (ids.length < 3) return;

    const elems = ids
      .map((id) => state.elements.get(id))
      .filter((el): el is MavisElement => el !== undefined && !el.isDeleted && !el.isLocked);

    if (elems.length < 3) return;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);
      const withBounds = elems.map((e) => ({ el: e, b: getElementBounds(e) }));

      if (direction === 'horizontal') {
        const sorted = withBounds.sort((a, b) => a.b.minX - b.b.minX);
        const firstX = sorted[0].b.minX;
        const lastX = sorted[sorted.length - 1].b.maxX;
        const totalWidth = sorted.reduce((sum, s) => sum + (s.b.maxX - s.b.minX), 0);
        const gap = (lastX - firstX - totalWidth) / (sorted.length - 1);

        let currentX = sorted[0].b.maxX + gap;
        for (let i = 1; i < sorted.length - 1; i++) {
          setMinX(sorted[i].el, next, currentX);
          currentX += sorted[i].b.maxX - sorted[i].b.minX + gap;
        }
      } else {
        const sorted = withBounds.sort((a, b) => a.b.minY - b.b.minY);
        const firstY = sorted[0].b.minY;
        const lastY = sorted[sorted.length - 1].b.maxY;
        const totalHeight = sorted.reduce((sum, s) => sum + (s.b.maxY - s.b.minY), 0);
        const gap = (lastY - firstY - totalHeight) / (sorted.length - 1);

        let currentY = sorted[0].b.maxY + gap;
        for (let i = 1; i < sorted.length - 1; i++) {
          setMinY(sorted[i].el, next, currentY);
          currentY += sorted[i].b.maxY - sorted[i].b.minY + gap;
        }
      }

      for (const { el } of withBounds) syncBoundElements(next, el.id);
      return { elements: next };
    });
  },

  // ── Stacking & locking ─────────────────────────────────────

  reorderElements: (ids: string[], action: ZOrderAction) => {
    const state = get();
    const targets = ids
      .map((id) => state.elements.get(id))
      .filter((el): el is MavisElement => !!el && !el.isDeleted);
    if (targets.length === 0) return;
    const diagramId = targets[0].diagramId;

    // Current stacking order of the diagram (labels excluded: they follow their shape)
    const ordered = sortByStacking(
      Array.from(state.elements.values()).filter(
        (el) =>
          el.diagramId === diagramId &&
          !el.isDeleted &&
          !(el.type === 'text' && el.containerId),
      ),
    );
    const moving = new Set(targets.filter((t) => !(t.type === 'text' && t.containerId)).map((t) => t.id));
    if (moving.size === 0) return;

    const result = reorder(ordered.map((el) => el.id), moving, action);
    if (result.every((id, i) => id === ordered[i].id)) return;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);
      result.forEach((id, index) => {
        const el = next.get(id);
        if (!el || el.zIndex === index) return;
        next.set(id, { ...el, zIndex: index, version: el.version + 1, updatedAt: Date.now() } as MavisElement);
        // Labels ride along with their shape
        for (const bound of el.boundElements) {
          if (bound.type !== 'text') continue;
          const label = next.get(bound.id);
          if (label && !label.isDeleted) {
            next.set(label.id, { ...label, zIndex: index, version: label.version + 1, updatedAt: Date.now() } as MavisElement);
          }
        }
      });
      return { elements: next };
    });
  },

  setElementsLocked: (ids: string[], locked: boolean) => {
    const state = get();
    const affected = withBoundLabels(state.elements, ids).filter((id) => {
      const el = state.elements.get(id);
      return el && el.isLocked !== locked;
    });
    if (affected.length === 0) return;

    state.pushHistory();
    set((prev) => {
      const next = new Map(prev.elements);
      for (const id of affected) {
        const el = next.get(id);
        if (el) {
          next.set(id, { ...el, isLocked: locked, version: el.version + 1, updatedAt: Date.now() } as MavisElement);
        }
      }
      return { elements: next };
    });
  },
}));

// ── Stacking helpers ───────────────────────────────────────────

/**
 * Sort elements bottom-to-top. Elements without an explicit zIndex keep their
 * insertion order beneath those that have one; a label always sits directly
 * above its container.
 */
export function sortByStacking(elements: MavisElement[]): MavisElement[] {
  const byId = new Map<string, MavisElement>();
  elements.forEach((el) => byId.set(el.id, el));
  const decorated = elements.map((el, index) => {
    let z = el.zIndex ?? Number.NEGATIVE_INFINITY;
    let isLabel = 0;
    if (el.type === 'text' && el.containerId) {
      const container = byId.get(el.containerId);
      if (container) {
        z = container.zIndex ?? Number.NEGATIVE_INFINITY;
        isLabel = 1;
      }
    }
    return { el, z, isLabel, index };
  });
  // Labels sort right after their container: compare by container insertion index
  const indexOf = new Map<string, number>();
  decorated.forEach((d) => indexOf.set(d.el.id, d.index));
  decorated.sort((a, b) => {
    if (a.z !== b.z) return a.z < b.z ? -1 : 1;
    const aAnchor =
      a.isLabel && a.el.type === 'text' && a.el.containerId
        ? indexOf.get(a.el.containerId) ?? a.index
        : a.index;
    const bAnchor =
      b.isLabel && b.el.type === 'text' && b.el.containerId
        ? indexOf.get(b.el.containerId) ?? b.index
        : b.index;
    if (aAnchor !== bAnchor) return aAnchor - bAnchor;
    if (a.isLabel !== b.isLabel) return a.isLabel - b.isLabel;
    return a.index - b.index;
  });
  return decorated.map((d) => d.el);
}

/** Move the `moving` ids within `order` (bottom-to-top) per the action. */
export function reorder(order: string[], moving: Set<string>, action: ZOrderAction): string[] {
  const kept = order.filter((id) => !moving.has(id));
  const moved = order.filter((id) => moving.has(id));

  if (action === 'front') return [...kept, ...moved];
  if (action === 'back') return [...moved, ...kept];

  const result = [...order];
  if (action === 'forward') {
    for (let i = result.length - 2; i >= 0; i--) {
      if (moving.has(result[i]) && !moving.has(result[i + 1])) {
        [result[i], result[i + 1]] = [result[i + 1], result[i]];
      }
    }
  } else {
    for (let i = 1; i < result.length; i++) {
      if (moving.has(result[i]) && !moving.has(result[i - 1])) {
        [result[i], result[i - 1]] = [result[i - 1], result[i]];
      }
    }
  }
  return result;
}

// ── Read-only mode (viewers) ───────────────────────────────────
// Every local mutation becomes a no-op; remote updates (setState via
// applyRemoteChanges) still flow in so viewers watch edits live.
let readOnly = false;

export function setElementsReadOnly(value: boolean): void {
  readOnly = value;
}

export function isElementsReadOnly(): boolean {
  return readOnly;
}

const MUTATORS = [
  'addElement',
  'updateElement',
  'updateElementSilent',
  'updateElements',
  'updateElementsSilent',
  'deleteElement',
  'deleteElements',
  'discardElements',
  'bindArrow',
  'unbindArrow',
  'moveElementWithBindings',
  'groupElements',
  'ungroupElements',
  'pasteElements',
  'duplicateElements',
  'alignElements',
  'distributeElements',
  'reorderElements',
  'setElementsLocked',
  'undo',
  'redo',
] as const;

{
  const original = useElementsStore.getState();
  const guarded: Partial<ElementsState> = {};
  for (const name of MUTATORS) {
    const fn = original[name] as (...args: unknown[]) => unknown;
    const fallback = name === 'pasteElements' || name === 'duplicateElements' ? [] : name === 'groupElements' ? '' : undefined;
    (guarded as Record<string, unknown>)[name] = (...args: unknown[]) =>
      readOnly ? fallback : fn(...args);
  }
  useElementsStore.setState(guarded);
}

// ── History recorder ───────────────────────────────────────────
// Observe every elements change and attribute it to the open undo step.
// Store operations that manage history themselves (undo/redo/reset) change
// `history`/`historyIndex` in the same update and are skipped.
useElementsStore.subscribe((state, prev) => {
  if (state.elements === prev.elements) return;
  if (unrecordedDepth > 0) return;
  if (state.history !== prev.history || state.historyIndex !== prev.historyIndex) return;

  const changed = diffElementMaps(prev.elements, state.elements);
  if (changed.length === 0) return;

  let { history, historyIndex } = state;
  let entry = historyIndex >= 0 ? history[historyIndex] : undefined;
  if (!entry || historyIndex !== history.length - 1) {
    // Change without an explicit step (or after an undo): open a new step
    entry = createEntry();
    history = [...history.slice(0, historyIndex + 1), entry];
    if (history.length > MAX_HISTORY) history = history.slice(history.length - MAX_HISTORY);
    historyIndex = history.length - 1;
    useElementsStore.setState({ history, historyIndex });
  }

  for (const id of changed) {
    recordChange(entry, id, prev.elements.get(id), state.elements.get(id));
  }
});

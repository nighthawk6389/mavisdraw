import React, { useRef, useEffect, useCallback, useState } from 'react';
import { CanvasRenderer } from './CanvasRenderer';
import type { RenderState, RemoteSelectionInfo } from './CanvasRenderer';
import { InteractionManager } from './InteractionManager';
import { useElementsStore } from '../../stores/elementsStore';
import { useToolStore } from '../../stores/toolStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUIStore } from '../../stores/uiStore';
import { useLayerStore } from '../../stores/layerStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { useCollaborationStore } from '../../stores/collaborationStore';
import { useCollaboration } from '../../hooks/useCollaboration';
import CursorOverlay from '../collaboration/CursorOverlay';
import { generateThumbnail } from '../../utils/thumbnailGenerator';
import { installTestHooks } from '../../utils/testHooks';
import { cssFont, measureText, whenFontsReady } from '../../utils/fonts';
import { insertImageFile } from '../../utils/imageInsert';
import { useViewportStore } from '../../stores/viewportStore';
import { sortByStacking, withoutHistory } from '../../stores/elementsStore';
import { WheelInterpreter } from './wheel';
import { registerCanvasController } from './canvasController';
import { elementWorldBounds } from './CanvasRenderer';
import ContextMenu, { type ContextMenuState } from './ContextMenu';
import ZoomControls from './ZoomControls';
import type { MavisElement, TextElement, PortalElement, RenderMode, Point } from '@mavisdraw/types';

interface TextEditState {
  elementId: string;
  isNew: boolean;
  isShapeBinding: boolean;
  shapeId?: string;
}

interface CanvasProps {
  interactionManagerRef?: React.MutableRefObject<{
    setSpacePressed: (p: boolean) => void;
  } | null>;
}

const DRILL_DOWN_DURATION = 300; // ms

export default function Canvas({ interactionManagerRef }: CanvasProps) {
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const interactiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textEditorRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const interactionRef = useRef<InteractionManager | null>(null);
  const animatingRef = useRef(false);

  // Text editing state
  const [textEditState, setTextEditState] = useState<TextEditState | null>(null);
  const textEditStartTimeRef = useRef<number>(0);

  // Context menu (opened by a right-click without dragging)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Pointer tracking: last canvas position (paste anchor) and active touches (pinch)
  const lastPointerCanvasRef = useRef<Point | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ distance: number; midX: number; midY: number } | null>(null);

  // ─── Store subscriptions ──────────────────────────────────

  const elements = useElementsStore((s) => s.elements);
  const addElement = useElementsStore((s) => s.addElement);
  const updateElement = useElementsStore((s) => s.updateElement);
  const deleteElements = useElementsStore((s) => s.deleteElements);
  const createElement = useElementsStore((s) => s.createElement);
  const pushHistory = useElementsStore((s) => s.pushHistory);
  const bindArrow = useElementsStore((s) => s.bindArrow);
  const unbindArrow = useElementsStore((s) => s.unbindArrow);
  const moveElementWithBindings = useElementsStore((s) => s.moveElementWithBindings);
  const createBoundText = useElementsStore((s) => s.createBoundText);

  const activeTool = useToolStore((s) => s.activeTool);
  const isToolLocked = useToolStore((s) => s.isToolLocked);
  const resetToSelect = useToolStore((s) => s.resetToSelect);

  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const hoveredId = useSelectionStore((s) => s.hoveredId);
  const selectionBox = useSelectionStore((s) => s.selectionBox);
  const select = useSelectionStore((s) => s.select);
  const addToSelection = useSelectionStore((s) => s.addToSelection);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const selectMultiple = useSelectionStore((s) => s.selectMultiple);
  const setHovered = useSelectionStore((s) => s.setHovered);
  const startSelectionBox = useSelectionStore((s) => s.startSelectionBox);
  const updateSelectionBox = useSelectionStore((s) => s.updateSelectionBox);
  const endSelectionBox = useSelectionStore((s) => s.endSelectionBox);

  const renderMode = useUIStore((s) => s.renderMode);
  const showGrid = useUIStore((s) => s.showGrid);
  const gridSize = useUIStore((s) => s.gridSize);

  const activeDiagramId = useDiagramStore((s) => s.activeDiagramId);
  const layers = useLayerStore((s) => s.layers);
  const navigateToDiagram = useDiagramStore((s) => s.navigateToDiagram);

  // ─── Collaboration ──────────────────────────────────────
  const { handleMouseMove: handleCollabMouseMove, handleViewportChange, followedViewport } =
    useCollaboration(activeDiagramId);
  const handleViewportChangeRef = useRef(handleViewportChange);
  handleViewportChangeRef.current = handleViewportChange;
  const connectedUsers = useCollaborationStore((s) => s.connectedUsers);
  const saveViewport = useDiagramStore((s) => s.saveViewport);
  const getViewport = useDiagramStore((s) => s.getViewport);
  const createDiagram = useDiagramStore((s) => s.createDiagram);

  // ─── Refs for render loop (avoid stale closures) ──────────

  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  const activeDiagramIdRef = useRef(activeDiagramId);
  activeDiagramIdRef.current = activeDiagramId;

  const stateRef = useRef<RenderState>({
    renderMode,
    selectedIds,
    hoveredId,
    selectionBox,
    creatingElement: null,
    showGrid,
    gridSize,
  });

  // Build remote selection info for soft-lock borders
  const remoteSelections: RemoteSelectionInfo[] = connectedUsers
    .filter((u) => u.selectedElementIds.length > 0)
    .map((u) => ({
      userId: u.id,
      userName: u.name,
      color: u.color,
      elementIds: u.selectedElementIds,
    }));

  // Build portal active user counts
  const portalActiveUsers = new Map<string, number>();
  for (const user of connectedUsers) {
    if (user.diagramId) {
      portalActiveUsers.set(
        user.diagramId,
        (portalActiveUsers.get(user.diagramId) ?? 0) + 1,
      );
    }
  }

  // Update state ref on each render (cheap)
  const interactionMgr = interactionRef.current;
  stateRef.current = {
    renderMode,
    selectedIds,
    hoveredId,
    selectionBox,
    creatingElement: interactionMgr?.getCreatingElement() ?? null,
    showGrid,
    gridSize,
    smartGuides: interactionMgr?.getSmartGuides() ?? [],
    remoteSelections,
    portalActiveUsers,
    anchorTarget: interactionMgr?.getAnchorTarget() ?? null,
    hoveredAnchor: interactionMgr?.getHoveredAnchor() ?? null,
    snapTarget: interactionMgr?.getSnapTarget() ?? null,
  };

  // ─── Memoized, stacking-sorted element lists ──────────────
  // Recomputed only when elements, diagram or layers change — not per frame.

  const renderListRef = useRef<{ key: unknown[]; result: MavisElement[] }>({ key: [], result: [] });
  const interactListRef = useRef<{ key: unknown[]; result: MavisElement[] }>({ key: [], result: [] });

  const computeElementList = useCallback((excludeLockedLayers: boolean): MavisElement[] => {
    const cacheRef = excludeLockedLayers ? interactListRef : renderListRef;
    const layers = useLayerStore.getState().layers;
    const key = [elementsRef.current, activeDiagramIdRef.current, layers];
    const cached = cacheRef.current;
    if (cached.key.length === key.length && key.every((k, i) => k === cached.key[i])) {
      return cached.result;
    }
    const known = new Set(layers.map((l) => l.id));
    const hidden = new Set(layers.filter((l) => !l.isVisible).map((l) => l.id));
    const locked = new Set(layers.filter((l) => l.isLocked).map((l) => l.id));
    const diagramId = activeDiagramIdRef.current;
    const els: MavisElement[] = [];
    for (const el of elementsRef.current.values()) {
      if (el.isDeleted || el.diagramId !== diagramId) continue;
      // Elements on layers this client doesn't know about stay visible
      if (known.has(el.layerId) && hidden.has(el.layerId)) continue;
      if (excludeLockedLayers && locked.has(el.layerId)) continue;
      els.push(el);
    }
    const result = sortByStacking(els);
    cacheRef.current = { key, result };
    return result;
  }, []);

  // ─── Text editing callbacks ────────────────────────────────

  const startTextEditing = useCallback(
    (element: MavisElement, isNew: boolean) => {
      textEditStartTimeRef.current = Date.now();

      // If element is a shape (not text), we need to create bound text
      const shapeTypes = new Set(['rectangle', 'ellipse', 'diamond', 'triangle']);
      if (shapeTypes.has(element.type)) {
        // Create a bound text element
        const textEl = createBoundText(element.id, '');
        setTextEditState({
          elementId: textEl.id,
          isNew: true,
          isShapeBinding: true,
          shapeId: element.id,
        });
        return;
      }

      setTextEditState({
        elementId: element.id,
        isNew,
        isShapeBinding: false,
      });
    },
    [createBoundText],
  );

  // The editing session that has already been committed (guards double commits
  // when a pointerdown commit is followed by the editor's blur event).
  const committedEditRef = useRef<TextEditState | null>(null);

  const finalizeTextEdit = useCallback((reason: 'blur' | 'explicit' = 'explicit') => {
    if (!textEditState || committedEditRef.current === textEditState) return;

    // Ignore the spurious blur right after opening the editor (the mouseup of
    // the click that created it steals focus). Explicit commits (Enter,
    // Escape, clicking elsewhere) are never ignored.
    const elapsed = Date.now() - textEditStartTimeRef.current;
    if (reason === 'blur' && elapsed < 150) {
      requestAnimationFrame(() => textEditorRef.current?.focus());
      return;
    }

    const editor = textEditorRef.current;
    if (!editor) return;
    committedEditRef.current = textEditState;
    interactionRef.current?.resetClickTracking();

    const text = editor.textContent || '';

    const store = useElementsStore.getState();
    // A new label/text is one undo step: creation + typing are merged
    const commit = (fn: () => void) =>
      textEditState.isNew ? store.amendLastHistoryEntry(fn) : fn();

    if (text.trim() === '' && textEditState.isNew) {
      // Nothing typed: the draft never existed
      commit(() => store.discardElements([textEditState.elementId]));
    } else if (text.trim() === '') {
      // Cleared an existing label: delete it
      deleteElements([textEditState.elementId]);
    } else {
      commit(() => {
        const el = useElementsStore.getState().getElementById(textEditState.elementId);
        if (!el || el.type !== 'text') return;
        const updates: Partial<TextElement> = { text };
        if (!el.containerId) {
          // Auto-size standalone text to its content
          const size = measureText(text, el.fontSize, el.fontFamily, el.lineHeight);
          updates.width = Math.max(size.width + 10, 20);
          updates.height = Math.max(size.height, el.fontSize * el.lineHeight);
        }
        updateElement(textEditState.elementId, updates as Partial<MavisElement>);
      });
    }

    setTextEditState(null);
    rendererRef.current?.invalidateStatic();
  }, [textEditState, deleteElements, updateElement]);

  // ─── Thumbnail generation helper ──────────────────────────

  const generateThumbnailForDiagram = useCallback(
    (diagramId: string) => {
      const renderer = rendererRef.current;
      if (!renderer) return;

      const visibleElements: MavisElement[] = [];
      for (const el of elementsRef.current.values()) {
        if (el.diagramId === diagramId && !el.isDeleted) {
          visibleElements.push(el);
        }
      }

      const currentRenderMode = useUIStore.getState().renderMode;

      const dataUrl = generateThumbnail(
        visibleElements,
        currentRenderMode,
        (ctx: CanvasRenderingContext2D, element: MavisElement, mode: RenderMode) => {
          renderer.renderElement(ctx, element, mode);
        },
      );

      return dataUrl;
    },
    [],
  );

  // ─── Portal drill-down handler ────────────────────────────

  const handlePortalDrillDown = useCallback(
    (portalElement: MavisElement) => {
      if (portalElement.type !== 'portal') return;
      const portal = portalElement as PortalElement;
      if (!portal.targetDiagramId) return;

      const renderer = rendererRef.current;
      const container = containerRef.current;
      if (!renderer || !container || animatingRef.current) return;

      const viewport = renderer.getViewport();
      const currentDiagramId = activeDiagramIdRef.current;

      // Save current viewport
      saveViewport(currentDiagramId, viewport.getViewport());

      // Generate thumbnail for current diagram before leaving
      const thumbnailDataUrl = generateThumbnailForDiagram(currentDiagramId);

      // Update the portal element in parent diagram with new thumbnail if found
      // Find portals in parent that link to current diagram
      for (const el of elementsRef.current.values()) {
        if (
          el.type === 'portal' &&
          (el as PortalElement).targetDiagramId === currentDiagramId &&
          !el.isDeleted
        ) {
          if (thumbnailDataUrl) {
            withoutHistory(() =>
              useElementsStore.getState().updateElementSilent(el.id, {
                thumbnailDataUrl,
              } as Partial<PortalElement>),
            );
          }
        }
      }

      // Clear selection before navigation
      clearSelection();

      // Animate zoom into portal bounds
      animatingRef.current = true;
      const startVP = viewport.getViewport();
      const { width: containerW, height: containerH } = container.getBoundingClientRect();

      // Compute target zoom that fills the viewport with the portal element
      const targetZoom = Math.min(
        containerW / portal.width,
        containerH / portal.height,
      ) * 0.8;
      const targetScrollX = containerW / 2 - (portal.x + portal.width / 2) * targetZoom;
      const targetScrollY = containerH / 2 - (portal.y + portal.height / 2) * targetZoom;

      const startTime = performance.now();

      const animate = (time: number) => {
        const elapsed = time - startTime;
        const t = Math.min(elapsed / DRILL_DOWN_DURATION, 1);
        // Ease-in-out
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

        viewport.setViewport({
          scrollX: startVP.scrollX + (targetScrollX - startVP.scrollX) * ease,
          scrollY: startVP.scrollY + (targetScrollY - startVP.scrollY) * ease,
          zoom: startVP.zoom + (targetZoom - startVP.zoom) * ease,
        });
        renderer.invalidateStatic();

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          // Animation complete — switch diagrams
          animatingRef.current = false;

          // Navigate to child diagram
          navigateToDiagram(portal.targetDiagramId);

          // Restore cached viewport for child, or reset
          const cachedVP = useDiagramStore.getState().getViewport(portal.targetDiagramId);
          if (cachedVP) {
            viewport.setViewport(cachedVP);
          } else {
            // Zoom-to-fit child diagram content
            const childElements: MavisElement[] = [];
            for (const el of useElementsStore.getState().elements.values()) {
              if (el.diagramId === portal.targetDiagramId && !el.isDeleted) {
                childElements.push(el);
              }
            }
            if (childElements.length > 0) {
              const bounds = getContentBounds(childElements);
              viewport.zoomToFit(bounds, containerW, containerH);
            } else {
              viewport.reset();
            }
          }
          renderer.invalidateStatic();
        }
      };

      requestAnimationFrame(animate);
    },
    [clearSelection, navigateToDiagram, saveViewport, generateThumbnailForDiagram],
  );

  const handlePortalDrillDownRef = useRef(handlePortalDrillDown);
  handlePortalDrillDownRef.current = handlePortalDrillDown;

  // ─── Portal creation handler ──────────────────────────────

  const handlePortalCreated = useCallback(
    (portalElement: MavisElement) => {
      if (portalElement.type !== 'portal') return;
      const portal = portalElement as PortalElement;

      const currentDiagramId = activeDiagramIdRef.current;
      const diagram = createDiagram(
        currentDiagramId,
        portal.id,
        portal.label || 'New Diagram',
      );

      // Link portal to the new diagram
      useElementsStore.getState().updateElement(portal.id, {
        targetDiagramId: diagram.id,
      } as Partial<PortalElement>);
    },
    [createDiagram],
  );

  // ─── Navigate back handler ────────────────────────────────

  const handleNavigateBack = useCallback(() => {
    const diagramStore = useDiagramStore.getState();
    if (diagramStore.diagramPath.length <= 1) return;

    const renderer = rendererRef.current;
    const container = containerRef.current;
    if (!renderer || !container) return;

    const viewport = renderer.getViewport();
    const currentDiagramId = activeDiagramIdRef.current;

    // Save current viewport
    saveViewport(currentDiagramId, viewport.getViewport());

    // Generate thumbnail before leaving
    const thumbnailDataUrl = generateThumbnailForDiagram(currentDiagramId);

    // Find portal element in parent diagram that points to current diagram
    if (thumbnailDataUrl) {
      for (const el of elementsRef.current.values()) {
        if (
          el.type === 'portal' &&
          (el as PortalElement).targetDiagramId === currentDiagramId &&
          !el.isDeleted
        ) {
          withoutHistory(() =>
            useElementsStore.getState().updateElementSilent(el.id, {
              thumbnailDataUrl,
            } as Partial<PortalElement>),
          );
        }
      }
    }

    // Clear selection
    clearSelection();

    // Navigate up
    diagramStore.navigateUp();

    // Restore parent viewport
    const parentId = diagramStore.activeDiagramId;
    const cachedVP = diagramStore.getViewport(parentId);
    if (cachedVP) {
      viewport.setViewport(cachedVP);
    } else {
      viewport.reset();
    }
    renderer.invalidateStatic();
  }, [clearSelection, saveViewport, generateThumbnailForDiagram]);

  // ─── Initialize renderer + interaction manager ────────────

  useEffect(() => {
    const staticCanvas = staticCanvasRef.current;
    const interactiveCanvas = interactiveCanvasRef.current;
    const container = containerRef.current;
    if (!staticCanvas || !interactiveCanvas || !container) return;

    const renderer = new CanvasRenderer(staticCanvas, interactiveCanvas);
    rendererRef.current = renderer;

    const { width, height } = container.getBoundingClientRect();
    renderer.resize(width, height);

    // Expose editor state for e2e tests (dev builds only)
    const uninstallTestHooks = installTestHooks({
      getViewport: () => renderer.getViewport().getViewport(),
      getActiveElements: () => {
        const diagramId = activeDiagramIdRef.current;
        const result: MavisElement[] = [];
        for (const el of useElementsStore.getState().elements.values()) {
          if (el.diagramId === diagramId && !el.isDeleted) result.push(el);
        }
        return result;
      },
      getActiveDiagramId: () => activeDiagramIdRef.current,
      getSelectedIds: () => Array.from(useSelectionStore.getState().selectedIds),
      seedRectangles: (count: number) => {
        const store = useElementsStore.getState();
        const cols = Math.ceil(Math.sqrt(count));
        withoutHistory(() =>
          useElementsStore.setState((prev) => {
            const next = new Map(prev.elements);
            for (let i = 0; i < count; i++) {
              const el = store.createElement(
                'rectangle',
                activeDiagramIdRef.current,
                (i % cols) * 140,
                Math.floor(i / cols) * 100,
                120,
                80,
              );
              next.set(el.id, el);
            }
            return { elements: next };
          }),
        );
      },
      getDrawnCount: () => renderer.lastDrawnCount,
    });

    // Publish pan/zoom to React UI (zoom readout) and collaborators
    renderer.onViewportChange = (vp) => {
      useViewportStore.getState().setViewport(vp);
      handleViewportChangeRef.current(vp);
    };

    // Repaint once the bundled hand-drawn font has loaded
    whenFontsReady().then(() => renderer.invalidateStatic());

    renderer.startRenderLoop(
      () => computeElementList(false),
      () => {
        const mgr = interactionRef.current;
        const state = stateRef.current;
        state.creatingElement = mgr?.getCreatingElement() ?? null;
        state.smartGuides = mgr?.getSmartGuides() ?? [];
        state.anchorTarget = mgr?.getAnchorTarget() ?? null;
        state.hoveredAnchor = mgr?.getHoveredAnchor() ?? null;
        state.snapTarget = mgr?.getSnapTarget() ?? null;
        return state;
      },
    );

    const containerSize = () => {
      const rect = container.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    };
    const zoomAtCenter = (factor: number) => {
      const { width: w, height: h } = containerSize();
      renderer.getViewport().zoomAt(w / 2, h / 2, factor);
      renderer.invalidateStatic();
    };
    const fitBounds = (els: MavisElement[]) => {
      const { width: w, height: h } = containerSize();
      if (els.length === 0) {
        renderer.getViewport().reset();
      } else {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const el of els) {
          const b = elementWorldBounds(el);
          minX = Math.min(minX, b.minX);
          minY = Math.min(minY, b.minY);
          maxX = Math.max(maxX, b.maxX);
          maxY = Math.max(maxY, b.maxY);
        }
        renderer.getViewport().zoomToFit(
          { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
          w,
          h,
          64,
        );
        // Never blow tiny content up past 200%
        const vp = renderer.getViewport().getViewport();
        if (vp.zoom > 2) renderer.getViewport().zoomAt(w / 2, h / 2, 2 / vp.zoom);
      }
      renderer.invalidateStatic();
    };

    registerCanvasController({
      zoomIn: () => zoomAtCenter(1.2),
      zoomOut: () => zoomAtCenter(1 / 1.2),
      resetZoom: () => {
        const vp = renderer.getViewport().getViewport();
        zoomAtCenter(1 / vp.zoom);
      },
      zoomToFit: () => fitBounds(computeElementList(false)),
      zoomToSelection: () => {
        const ids = useSelectionStore.getState().selectedIds;
        const selected = computeElementList(false).filter((el) => ids.has(el.id));
        fitBounds(selected.length > 0 ? selected : computeElementList(false));
      },
      getPasteAnchor: () => {
        if (lastPointerCanvasRef.current) return lastPointerCanvasRef.current;
        const { width: w, height: h } = containerSize();
        return renderer.getViewport().screenToCanvas(w / 2, h / 2);
      },
      invalidate: () => renderer.invalidateStatic(),
      openPortal: (portalId: string) => {
        const portal = useElementsStore.getState().elements.get(portalId);
        if (portal) handlePortalDrillDownRef.current(portal);
      },
    });

    return () => {
      registerCanvasController(null);
      renderer.onViewportChange = null;
      uninstallTestHooks();
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Create interaction manager (separate effect to avoid dependency issues)
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const mgr = new InteractionManager(
      {
        getElements: () => computeElementList(true),
        getActiveTool: () => useToolStore.getState().activeTool,
        getSelectedIds: () => useSelectionStore.getState().selectedIds,
        getViewport: () => renderer.getViewport(),
        select,
        selectMultiple,
        addToSelection,
        clearSelection,
        selectElementsInBox: (ids) => selectMultiple(ids),
        setHovered,
        startSelectionBox,
        updateSelectionBox,
        endSelectionBox: () => { endSelectionBox(); },
        createElement: (type, _diagramId, x, y, w, h) => {
          const elementType = type as Parameters<typeof createElement>[0];
          return useElementsStore
            .getState()
            .createElement(elementType, activeDiagramIdRef.current, x, y, w, h);
        },
        addElement,
        updateElement,
        updateElementSilent: (id, updates) => {
          useElementsStore.getState().updateElementSilent(id, updates);
        },
        deleteSelectedElements: () => {
          const ids = Array.from(useSelectionStore.getState().selectedIds);
          if (ids.length > 0) {
            deleteElements(ids);
            clearSelection();
          }
        },
        pushHistory,
        bindArrow: (arrowId, endpoint, targetId, gap) => {
          useElementsStore.getState().bindArrow(arrowId, endpoint, targetId, gap);
        },
        unbindArrow: (arrowId, endpoint) => {
          useElementsStore.getState().unbindArrow(arrowId, endpoint);
        },
        moveElementWithBindings: (id, newX, newY) => {
          useElementsStore.getState().moveElementWithBindings(id, newX, newY);
        },
        startTextEditing: (element, isNew) => {
          startTextEditing(element, isNew);
        },
        resetToSelect: () => useToolStore.getState().resetToSelect(),
        isToolLocked: () => useToolStore.getState().isToolLocked,
        invalidateStatic: () => renderer.invalidateStatic(),
        onPortalDrillDown: (portalElement: MavisElement) => {
          handlePortalDrillDown(portalElement);
        },
        onPortalCreated: (portalElement: MavisElement) => {
          handlePortalCreated(portalElement);
        },
      },
      activeDiagramIdRef.current,
    );
    interactionRef.current = mgr;

    // Expose setSpacePressed to the keyboard hook
    if (interactionManagerRef) {
      interactionManagerRef.current = mgr;
    }

    return () => {
      interactionRef.current = null;
      if (interactionManagerRef) {
        interactionManagerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Update interaction manager when active diagram changes ─

  useEffect(() => {
    interactionRef.current?.setDiagramId(activeDiagramId);
    rendererRef.current?.invalidateStatic();
  }, [activeDiagramId]);

  // ─── Apply followed user's viewport ────────────────────────

  useEffect(() => {
    if (!followedViewport) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.getViewport().setViewport(followedViewport);
    renderer.invalidateStatic();
  }, [followedViewport]);

  // ─── Invalidate static layer on data changes ─────────────

  useEffect(() => {
    rendererRef.current?.invalidateStatic();
  }, [elements, renderMode, showGrid, gridSize, layers]);

  // ─── ResizeObserver ───────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        rendererRef.current?.resize(width, height);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ─── Focus text editor when editing ────────────────────────

  useEffect(() => {
    if (textEditState && textEditorRef.current) {
      const editor = textEditorRef.current;
      const el = useElementsStore.getState().getElementById(textEditState.elementId);
      if (el && el.type === 'text') {
        const textEl = el as TextElement;
        editor.textContent = textEl.text;
      }

      // Focus and select all
      editor.focus();
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        if (!textEditState.isNew) {
          range.collapse(false); // cursor at end for existing text
        }
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  }, [textEditState]);

  // ─── Pointer Events ──────────────────────────────────────
  // Pointer events cover mouse, pen and touch; pointer capture keeps a drag
  // alive when the cursor leaves the canvas. Each gesture is one undo step.

  const getCanvasOffset = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = interactiveCanvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const applyCursor = useCallback(() => {
    const canvas = interactiveCanvasRef.current;
    const mgr = interactionRef.current;
    if (!canvas || !mgr) return;
    canvas.style.cursor =
      useToolStore.getState().activeTool === 'select' && mgr.getMode() === 'idle'
        ? mgr.getHoverCursor()
        : '';
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (textEditState) finalizeTextEdit();
      setContextMenu(null);

      const mgr = interactionRef.current;
      if (!mgr) return;
      const pos = getCanvasOffset(e);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      activePointersRef.current.set(e.pointerId, pos);

      // Second finger: turn the gesture into a pinch (zoom + pan)
      if (e.pointerType === 'touch' && activePointersRef.current.size === 2) {
        mgr.cancelGesture();
        useElementsStore.getState().endHistoryBatch();
        const [a, b] = Array.from(activePointersRef.current.values());
        pinchRef.current = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          midX: (a.x + b.x) / 2,
          midY: (a.y + b.y) / 2,
        };
        return;
      }
      if (activePointersRef.current.size > 1) return;

      useElementsStore.getState().beginHistoryBatch();
      mgr.onPointerDown(pos.x, pos.y, { button: e.button, shiftKey: e.shiftKey });
    },
    [getCanvasOffset, textEditState, finalizeTextEdit],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const mgr = interactionRef.current;
      const renderer = rendererRef.current;
      if (!mgr || !renderer) return;
      const pos = getCanvasOffset(e);

      if (activePointersRef.current.has(e.pointerId)) {
        activePointersRef.current.set(e.pointerId, pos);
      }

      const pinch = pinchRef.current;
      if (pinch && activePointersRef.current.size >= 2) {
        const [a, b] = Array.from(activePointersRef.current.values());
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const viewport = renderer.getViewport();
        viewport.pan(midX - pinch.midX, midY - pinch.midY);
        if (pinch.distance > 0) viewport.zoomAt(midX, midY, distance / pinch.distance);
        pinchRef.current = { distance, midX, midY };
        renderer.invalidateStatic();
        return;
      }

      mgr.onPointerMove(pos.x, pos.y, { shiftKey: e.shiftKey });
      applyCursor();

      const canvasPos = renderer.getViewport().screenToCanvas(pos.x, pos.y);
      lastPointerCanvasRef.current = canvasPos;
      handleCollabMouseMove(canvasPos.x, canvasPos.y);
    },
    [getCanvasOffset, handleCollabMouseMove, applyCursor],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const mgr = interactionRef.current;
      if (!mgr) return;
      const wasTracked = activePointersRef.current.delete(e.pointerId);

      if (pinchRef.current) {
        if (activePointersRef.current.size < 2) pinchRef.current = null;
        return;
      }
      if (!wasTracked) return;

      const pos = getCanvasOffset(e);
      mgr.onPointerUp(pos.x, pos.y);
      useElementsStore.getState().endHistoryBatch();
      applyCursor();

      if (mgr.consumeContextMenuRequest()) {
        // Right-click on an unselected element selects it first (like every desktop app)
        const hit = mgr.hitTestAt(pos.x, pos.y);
        const selected = useSelectionStore.getState().selectedIds;
        if (hit && !selected.has(hit.id)) {
          useSelectionStore.getState().selectMultiple(mgr.getSelectionFor(hit));
        } else if (!hit) {
          useSelectionStore.getState().clearSelection();
        }
        const canvasPoint = rendererRef.current!.getViewport().screenToCanvas(pos.x, pos.y);
        lastPointerCanvasRef.current = canvasPoint;
        setContextMenu({ x: pos.x, y: pos.y, canvasPoint, onElement: !!hit });
      }
    },
    [getCanvasOffset, applyCursor],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Our own menu opens on right-button release (so right-drag can pan)
    e.preventDefault();
  }, []);

  // Wheel must be a non-passive native listener, otherwise preventDefault()
  // is ignored and pinch-zoom zooms the whole page instead of the canvas.
  useEffect(() => {
    const canvas = interactiveCanvasRef.current;
    if (!canvas) return;
    const interpreter = new WheelInterpreter('auto');
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const mgr = interactionRef.current;
      if (!mgr) return;
      const rect = canvas.getBoundingClientRect();
      const intent = interpreter.interpret({
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        timeStamp: e.timeStamp,
        wheelDeltaY: (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY,
      });
      mgr.onWheel(e.clientX - rect.left, e.clientY - rect.top, intent);
      setContextMenu(null);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // ─── Image Drop ────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const renderer = rendererRef.current;
    if (!renderer) return;
    const pos = getCanvasOffset(e);
    const at = renderer.getViewport().screenToCanvas(pos.x, pos.y);
    for (const file of Array.from(e.dataTransfer.files)) {
      if (file.type.startsWith('image/')) insertImageFile(file, at);
    }
  }, [getCanvasOffset]);

  // ─── Text Editor Key Handling ──────────────────────────────

  const handleTextEditorKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finalizeTextEdit();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finalizeTextEdit();
      }
      // Shift+Enter adds a newline (default behavior for contentEditable)
    },
    [finalizeTextEdit],
  );

  // ─── Cursor ───────────────────────────────────────────────

  const getCursorClass = (): string => {
    const mode = interactionRef.current?.getMode();
    if (mode === 'panning') return 'cursor-grabbing';
    if (activeTool === 'hand') return 'cursor-grab';
    if (activeTool === 'select') return 'cursor-default';
    if (activeTool === 'text') return 'cursor-text';
    return 'cursor-crosshair';
  };

  // ─── Text Editor Positioning ───────────────────────────────

  const getTextEditorStyle = (): React.CSSProperties | null => {
    if (!textEditState) return null;

    const el = useElementsStore.getState().getElementById(textEditState.elementId);
    if (!el || el.type !== 'text') return null;

    const textEl = el as TextElement;
    const renderer = rendererRef.current;
    if (!renderer) return null;

    const vp = renderer.getViewport().getViewport();
    const screenPos = renderer.getViewport().canvasToScreen(textEl.x, textEl.y);

    return {
      position: 'absolute',
      left: `${screenPos.x}px`,
      top: `${screenPos.y}px`,
      width: `${textEl.width * vp.zoom}px`,
      minHeight: `${textEl.height * vp.zoom}px`,
      font: cssFont(textEl.fontSize * vp.zoom, textEl.fontFamily),
      color: textEl.strokeColor,
      textAlign: textEl.textAlign,
      outline: 'none',
      border: '1px solid rgba(74, 144, 217, 0.4)',
      borderRadius: '2px',
      background: 'rgba(255, 255, 255, 0.8)',
      padding: '0',
      margin: '0',
      overflow: 'hidden',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      lineHeight: `${textEl.lineHeight}`,
      caretColor: textEl.strokeColor,
      zIndex: 100,
      transformOrigin: 'top left',
    };
  };

  const textEditorStyle = getTextEditorStyle();

  // ─── Render ───────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className={`relative flex-1 overflow-hidden ${getCursorClass()}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <canvas
        ref={staticCanvasRef}
        className="absolute inset-0"
        style={{ pointerEvents: 'none' }}
      />
      <canvas
        ref={interactiveCanvasRef}
        className="absolute inset-0"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
      />
      <CursorOverlay />
      <ZoomControls />
      {contextMenu && (
        <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      )}
      {textEditState && textEditorStyle && (
        <div
          ref={textEditorRef}
          contentEditable
          suppressContentEditableWarning
          style={textEditorStyle}
          onKeyDown={handleTextEditorKeyDown}
          onBlur={() => finalizeTextEdit('blur')}
        />
      )}
    </div>
  );
}

// ─── Utility ──────────────────────────────────────────────────

function getContentBounds(elements: MavisElement[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    if (el.x < minX) minX = el.x;
    if (el.y < minY) minY = el.y;
    if (el.x + el.width > maxX) maxX = el.x + el.width;
    if (el.y + el.height > maxY) maxY = el.y + el.height;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

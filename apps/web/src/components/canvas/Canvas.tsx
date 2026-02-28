import React, { useRef, useEffect, useCallback } from 'react';
import { CanvasRenderer } from './CanvasRenderer';
import type { RenderState } from './CanvasRenderer';
import { InteractionManager } from './InteractionManager';
import { useElementsStore } from '../../stores/elementsStore';
import { useToolStore } from '../../stores/toolStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUIStore } from '../../stores/uiStore';
import type { MavisElement } from '@mavisdraw/types';

interface CanvasProps {
  interactionManagerRef?: React.MutableRefObject<{ setSpacePressed: (p: boolean) => void } | null>;
}

const DEFAULT_DIAGRAM_ID = 'default-diagram';

export default function Canvas({ interactionManagerRef }: CanvasProps) {
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const interactiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const interactionRef = useRef<InteractionManager | null>(null);

  // ─── Store subscriptions ──────────────────────────────────

  const elements = useElementsStore((s) => s.elements);
  const addElement = useElementsStore((s) => s.addElement);
  const updateElement = useElementsStore((s) => s.updateElement);
  const deleteElements = useElementsStore((s) => s.deleteElements);
  const createElement = useElementsStore((s) => s.createElement);
  const pushHistory = useElementsStore((s) => s.pushHistory);

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

  // ─── Refs for render loop (avoid stale closures) ──────────

  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  const stateRef = useRef<RenderState>({
    renderMode,
    selectedIds,
    hoveredId,
    selectionBox,
    creatingElement: null,
    showGrid,
    gridSize,
  });

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
  };

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

    renderer.startRenderLoop(
      () => {
        const els: MavisElement[] = [];
        for (const el of elementsRef.current.values()) {
          if (!el.isDeleted) els.push(el);
        }
        return els;
      },
      () => stateRef.current,
    );

    return () => {
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
        getElements: () => {
          const els: MavisElement[] = [];
          for (const el of elementsRef.current.values()) {
            if (!el.isDeleted) els.push(el);
          }
          return els;
        },
        getActiveTool: () => useToolStore.getState().activeTool,
        getSelectedIds: () => useSelectionStore.getState().selectedIds,
        getViewport: () => renderer.getViewport(),
        select,
        addToSelection,
        clearSelection,
        selectElementsInBox: (ids) => selectMultiple(ids),
        setHovered,
        startSelectionBox,
        updateSelectionBox,
        endSelectionBox: () => { endSelectionBox(); },
        createElement: (type, diagramId, x, y, w, h) => {
          const elementType = type as any;
          return useElementsStore.getState().createElement(elementType, diagramId, x, y, w, h);
        },
        addElement,
        updateElement,
        deleteSelectedElements: () => {
          const ids = Array.from(useSelectionStore.getState().selectedIds);
          if (ids.length > 0) {
            deleteElements(ids);
            clearSelection();
          }
        },
        pushHistory,
        resetToSelect: () => useToolStore.getState().resetToSelect(),
        isToolLocked: () => useToolStore.getState().isToolLocked,
        invalidateStatic: () => renderer.invalidateStatic(),
      },
      DEFAULT_DIAGRAM_ID,
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

  // ─── Invalidate static layer on data changes ─────────────

  useEffect(() => {
    rendererRef.current?.invalidateStatic();
  }, [elements, renderMode, showGrid, gridSize]);

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

  // ─── Mouse Events ────────────────────────────────────────

  const getCanvasOffset = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const mgr = interactionRef.current;
    if (!mgr) return;
    const pos = getCanvasOffset(e as any);
    mgr.onWheel(pos.x, pos.y, e.deltaX, e.deltaY, e.ctrlKey || e.metaKey);
  }, [getCanvasOffset]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const mgr = interactionRef.current;
    if (!mgr) return;
    const pos = getCanvasOffset(e);
    mgr.onPointerDown(pos.x, pos.y, { button: e.button, shiftKey: e.shiftKey });
  }, [getCanvasOffset]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const mgr = interactionRef.current;
    if (!mgr) return;
    const pos = getCanvasOffset(e);
    mgr.onPointerMove(pos.x, pos.y);
  }, [getCanvasOffset]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const mgr = interactionRef.current;
    if (!mgr) return;
    const pos = getCanvasOffset(e);
    mgr.onPointerUp(pos.x, pos.y);
  }, [getCanvasOffset]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
  }, []);

  // ─── Cursor ───────────────────────────────────────────────

  const getCursorClass = (): string => {
    const mode = interactionRef.current?.getMode();
    if (mode === 'panning') return 'cursor-grabbing';
    if (activeTool === 'hand') return 'cursor-grab';
    if (activeTool === 'select') return 'cursor-default';
    return 'cursor-crosshair';
  };

  // ─── Render ───────────────────────────────────────────────

  return (
    <div ref={containerRef} className={`relative flex-1 overflow-hidden ${getCursorClass()}`}>
      <canvas
        ref={staticCanvasRef}
        className="absolute inset-0"
        style={{ pointerEvents: 'none' }}
      />
      <canvas
        ref={interactiveCanvasRef}
        className="absolute inset-0"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
      />
    </div>
  );
}

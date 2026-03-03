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
import type { MavisElement, TextElement, ImageElement, PortalElement, RenderMode } from '@mavisdraw/types';

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
  const navigateToDiagram = useDiagramStore((s) => s.navigateToDiagram);

  // ─── Collaboration ──────────────────────────────────────
  const { handleMouseMove: handleCollabMouseMove, handleViewportChange, followedViewport } =
    useCollaboration(activeDiagramId);
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

  const finalizeTextEdit = useCallback(() => {
    if (!textEditState) return;

    // Guard against the initial blur that occurs when the mouseup (from the
    // click that created the text element) steals focus from the editor.
    const elapsed = Date.now() - textEditStartTimeRef.current;
    if (elapsed < 150) {
      // Re-focus the editor instead of closing it
      requestAnimationFrame(() => textEditorRef.current?.focus());
      return;
    }

    const editor = textEditorRef.current;
    if (!editor) return;

    const text = editor.textContent || '';

    if (text.trim() === '' && textEditState.isNew) {
      // Delete empty new text elements
      deleteElements([textEditState.elementId]);
      if (textEditState.isShapeBinding && textEditState.shapeId) {
        // Remove from shape's boundElements
        const shape = useElementsStore.getState().getElementById(textEditState.shapeId);
        if (shape) {
          updateElement(textEditState.shapeId, {
            boundElements: shape.boundElements.filter(
              (b) => b.id !== textEditState.elementId,
            ),
          });
        }
      }
    } else {
      updateElement(textEditState.elementId, { text });

      // Recalculate text bounds based on content
      const el = useElementsStore.getState().getElementById(textEditState.elementId);
      if (el && el.type === 'text') {
        const textEl = el as TextElement;
        if (!textEl.containerId) {
          // Auto-size standalone text
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (ctx) {
            let fontFace = 'sans-serif';
            if (textEl.fontFamily === 'hand-drawn') {
              fontFace = '"Virgil", cursive';
            } else if (textEl.fontFamily === 'monospace') {
              fontFace = 'monospace';
            }
            ctx.font = `${textEl.fontSize}px ${fontFace}`;
            const lines = text.split('\n');
            let maxWidth = 0;
            for (const line of lines) {
              maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
            }
            const height = lines.length * textEl.fontSize * textEl.lineHeight;
            updateElement(textEditState.elementId, {
              width: Math.max(maxWidth + 10, 20),
              height: Math.max(height, textEl.fontSize * textEl.lineHeight),
            });
          }
        }
      }
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
            useElementsStore.getState().updateElement(el.id, {
              thumbnailDataUrl,
            } as Partial<PortalElement>);
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
          useElementsStore.getState().updateElement(el.id, {
            thumbnailDataUrl,
          } as Partial<PortalElement>);
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

    renderer.startRenderLoop(
      () => {
        const currentDiagramId = activeDiagramIdRef.current;
        const els: MavisElement[] = [];
        const visibleLayerIds = useLayerStore.getState().getVisibleLayerIds();
        for (const el of elementsRef.current.values()) {
          if (!el.isDeleted && el.diagramId === currentDiagramId && visibleLayerIds.has(el.layerId)) {
            els.push(el);
          }
        }
        return els;
      },
      () => {
        const mgr = interactionRef.current;
        stateRef.current.creatingElement = mgr?.getCreatingElement() ?? null;
        stateRef.current.smartGuides = mgr?.getSmartGuides() ?? [];
        return stateRef.current;
      },
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
          const currentDiagramId = activeDiagramIdRef.current;
          const els: MavisElement[] = [];
          const visibleLayerIds = useLayerStore.getState().getVisibleLayerIds();
          const lockedLayerIds = useLayerStore.getState().getLockedLayerIds();
          for (const el of elementsRef.current.values()) {
            if (!el.isDeleted && el.diagramId === currentDiagramId && visibleLayerIds.has(el.layerId) && !lockedLayerIds.has(el.layerId)) {
              els.push(el);
            }
          }
          return els;
        },
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

  // ─── Mouse Events ────────────────────────────────────────

  const getCanvasOffset = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const mgr = interactionRef.current;
    if (!mgr) return;
    const pos = getCanvasOffset(e as unknown as React.MouseEvent<HTMLCanvasElement>);
    mgr.onWheel(pos.x, pos.y, e.deltaX, e.deltaY, e.ctrlKey || e.metaKey);
  }, [getCanvasOffset]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Close text editor if open
    if (textEditState) {
      finalizeTextEdit();
    }

    const mgr = interactionRef.current;
    if (!mgr) return;
    const pos = getCanvasOffset(e);
    mgr.onPointerDown(pos.x, pos.y, { button: e.button, shiftKey: e.shiftKey });
  }, [getCanvasOffset, textEditState, finalizeTextEdit]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const mgr = interactionRef.current;
    if (!mgr) return;
    const pos = getCanvasOffset(e);
    mgr.onPointerMove(pos.x, pos.y);

    // Send cursor position to collaboration (in canvas coordinates)
    const renderer = rendererRef.current;
    if (renderer) {
      const canvasPos = renderer.getViewport().screenToCanvas(pos.x, pos.y);
      handleCollabMouseMove(canvasPos.x, canvasPos.y);
    }
  }, [getCanvasOffset, handleCollabMouseMove]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const mgr = interactionRef.current;
    if (!mgr) return;
    const pos = getCanvasOffset(e);
    mgr.onPointerUp(pos.x, pos.y);
  }, [getCanvasOffset]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
  }, []);

  // ─── Image Drop/Paste ──────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();

    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (imageFiles.length === 0) return;

    const renderer = rendererRef.current;
    if (!renderer) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const canvasPoint = renderer.getViewport().screenToCanvas(screenX, screenY);

    for (const file of imageFiles) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const dataUrl = evt.target?.result as string;
        if (!dataUrl) return;

        // Create an image to get dimensions
        const img = new Image();
        img.onload = () => {
          const maxWidth = 400;
          const maxHeight = 400;
          let width = img.naturalWidth;
          let height = img.naturalHeight;

          // Scale down if too large
          if (width > maxWidth || height > maxHeight) {
            const scale = Math.min(maxWidth / width, maxHeight / height);
            width = width * scale;
            height = height * scale;
          }

          const aspectRatio = width / height;

          const imageEl = useElementsStore.getState().createElement(
            'image',
            activeDiagramIdRef.current,
            canvasPoint.x,
            canvasPoint.y,
            width,
            height,
          ) as ImageElement;

          const finalEl: ImageElement = {
            ...imageEl,
            imageUrl: dataUrl,
            aspectRatio,
          };

          useElementsStore.getState().addElement(finalEl);
          select(finalEl.id);
          renderer.invalidateStatic();
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    }
  }, [select]);

  // Handle paste for images from clipboard
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Don't handle if editing text
      if (textEditState) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;

          const reader = new FileReader();
          reader.onload = (evt) => {
            const dataUrl = evt.target?.result as string;
            if (!dataUrl) return;

            const img = new Image();
            img.onload = () => {
              const maxWidth = 400;
              const maxHeight = 400;
              let width = img.naturalWidth;
              let height = img.naturalHeight;

              if (width > maxWidth || height > maxHeight) {
                const scale = Math.min(maxWidth / width, maxHeight / height);
                width = width * scale;
                height = height * scale;
              }

              const aspectRatio = width / height;
              const renderer = rendererRef.current;
              if (!renderer) return;

              // Paste at center of viewport
              const vp = renderer.getViewport().getViewport();
              const container = containerRef.current;
              if (!container) return;
              const rect = container.getBoundingClientRect();
              const centerScreen = { x: rect.width / 2, y: rect.height / 2 };
              const canvasPoint = renderer.getViewport().screenToCanvas(
                centerScreen.x,
                centerScreen.y,
              );

              const imageEl = useElementsStore.getState().createElement(
                'image',
                activeDiagramIdRef.current,
                canvasPoint.x - width / 2,
                canvasPoint.y - height / 2,
                width,
                height,
              ) as ImageElement;

              const finalEl: ImageElement = {
                ...imageEl,
                imageUrl: dataUrl,
                aspectRatio,
              };

              useElementsStore.getState().addElement(finalEl);
              useSelectionStore.getState().select(finalEl.id);
              renderer.invalidateStatic();
            };
            img.src = dataUrl;
          };
          reader.readAsDataURL(blob);
          break; // Only handle first image
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [textEditState]);

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

    let fontFace = 'sans-serif';
    if (textEl.fontFamily === 'hand-drawn') {
      fontFace = '"Virgil", "Segoe UI Emoji", cursive';
    } else if (textEl.fontFamily === 'monospace') {
      fontFace = '"Cascadia Code", "Fira Code", monospace';
    }

    return {
      position: 'absolute',
      left: `${screenPos.x}px`,
      top: `${screenPos.y}px`,
      width: `${textEl.width * vp.zoom}px`,
      minHeight: `${textEl.height * vp.zoom}px`,
      font: `${textEl.fontSize * vp.zoom}px ${fontFace}`,
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
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
      />
      <CursorOverlay />
      {textEditState && textEditorStyle && (
        <div
          ref={textEditorRef}
          contentEditable
          suppressContentEditableWarning
          style={textEditorStyle}
          onKeyDown={handleTextEditorKeyDown}
          onBlur={finalizeTextEdit}
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

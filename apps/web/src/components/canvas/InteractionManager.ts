import type { MavisElement, Point, Bounds, LinearElement, TextElement } from '@mavisdraw/types';
import type { Tool } from '../../stores/toolStore';
import type { ViewportManager } from './ViewportManager';
import type { SmartGuide } from './CanvasRenderer';
import {
  hitTestElements,
  hitTestSelectionBox,
  hitTestResizeHandle,
  findBindingTarget,
  hitTestElementsWithGroups,
  getGroupElementIds,
  type ResizeHandle,
} from './HitTesting';
import { simplifyTuplePoints } from '@mavisdraw/math';

export type InteractionMode =
  | 'idle'
  | 'panning'
  | 'creating'
  | 'dragging'
  | 'resizing'
  | 'selecting'
  | 'drawing-freedraw';

export interface InteractionCallbacks {
  getElements: () => MavisElement[];
  getActiveTool: () => Tool;
  getSelectedIds: () => Set<string>;
  getViewport: () => ViewportManager;

  // Selection
  select: (id: string) => void;
  selectMultiple: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  clearSelection: () => void;
  selectElementsInBox: (ids: string[]) => void;
  setHovered: (id: string | null) => void;

  // Selection box visual
  startSelectionBox: (point: Point) => void;
  updateSelectionBox: (point: Point) => void;
  endSelectionBox: () => void;

  // Element CRUD
  createElement: (
    type: Tool,
    diagramId: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => MavisElement;
  addElement: (element: MavisElement) => void;
  updateElement: (id: string, updates: Partial<MavisElement>) => void;
  deleteSelectedElements: () => void;
  pushHistory: () => void;

  // Binding
  bindArrow: (
    arrowId: string,
    endpoint: 'start' | 'end',
    targetId: string,
    gap: number,
  ) => void;
  unbindArrow: (arrowId: string, endpoint: 'start' | 'end') => void;
  moveElementWithBindings: (id: string, newX: number, newY: number) => void;

  // Text editing
  startTextEditing: (element: MavisElement, isNew: boolean) => void;

  // Tool
  resetToSelect: () => void;
  isToolLocked: () => boolean;

  // Render
  invalidateStatic: () => void;

  // Portal drill-down
  onPortalDrillDown?: (portalElement: MavisElement) => void;
  onPortalCreated?: (portalElement: MavisElement) => void;
}

const SHAPE_TOOLS = new Set<Tool>([
  'rectangle',
  'ellipse',
  'diamond',
  'line',
  'arrow',
  'freedraw',
  'text',
  'portal',
]);

const SMART_GUIDE_THRESHOLD = 5; // pixels in screen space

export class InteractionManager {
  private mode: InteractionMode = 'idle';
  private callbacks: InteractionCallbacks;
  private diagramId: string;

  // Tracking state
  private startCanvasPoint: Point = { x: 0, y: 0 };
  private startScreenPoint: Point = { x: 0, y: 0 };
  private lastScreenPoint: Point = { x: 0, y: 0 };
  private creatingElement: MavisElement | null = null;
  private creatingSeed: number = 0;
  private creatingId: string = '';
  private dragStartPositions: Map<string, Point> = new Map();
  private resizeHandle: ResizeHandle | null = null;
  private resizeStartBounds: Bounds | null = null;
  private isSpacePressed = false;
  private freedrawPoints: [number, number][] = [];

  // Smart guides state
  private currentSmartGuides: SmartGuide[] = [];

  // Group navigation state
  private enteredGroupIds: Set<string> = new Set();

  // Double-click tracking
  private lastClickTime = 0;
  private lastClickId: string | null = null;
  private static readonly DOUBLE_CLICK_THRESHOLD = 300;

  constructor(callbacks: InteractionCallbacks, diagramId: string) {
    this.callbacks = callbacks;
    this.diagramId = diagramId;
  }

  setDiagramId(id: string): void {
    this.diagramId = id;
  }

  getMode(): InteractionMode {
    return this.mode;
  }

  getCreatingElement(): MavisElement | null {
    return this.creatingElement;
  }

  getSmartGuides(): SmartGuide[] {
    return this.currentSmartGuides;
  }

  setSpacePressed(pressed: boolean): void {
    this.isSpacePressed = pressed;
  }

  getEnteredGroupIds(): Set<string> {
    return this.enteredGroupIds;
  }

  // ─── Mouse Events ─────────────────────────────────────────

  onPointerDown(screenX: number, screenY: number, event: { button: number; shiftKey: boolean }): void {
    const viewport = this.callbacks.getViewport();
    const canvasPoint = viewport.screenToCanvas(screenX, screenY);
    this.startCanvasPoint = canvasPoint;
    this.startScreenPoint = { x: screenX, y: screenY };
    this.lastScreenPoint = { x: screenX, y: screenY };

    // Middle mouse button or space+click = pan
    if (event.button === 1 || this.isSpacePressed || this.callbacks.getActiveTool() === 'hand') {
      this.mode = 'panning';
      return;
    }

    // Right click = ignore (context menu)
    if (event.button === 2) return;

    const tool = this.callbacks.getActiveTool();
    const elements = this.callbacks.getElements();
    const selectedIds = this.callbacks.getSelectedIds();

    if (tool === 'select') {
      // Check resize handle hit first
      if (selectedIds.size > 0) {
        const selBounds = this.getSelectionBounds(elements, selectedIds);
        if (selBounds) {
          const handle = hitTestResizeHandle(canvasPoint, selBounds);
          if (handle) {
            this.mode = 'resizing';
            this.resizeHandle = handle;
            this.resizeStartBounds = selBounds;
            this.captureElementPositions(elements, selectedIds);
            this.callbacks.pushHistory();
            return;
          }
        }
      }

      // Check element hit (with group awareness)
      const hitElement = hitTestElementsWithGroups(canvasPoint, elements, this.enteredGroupIds);
      if (hitElement) {
        // Check for double-click
        const now = Date.now();
        const isDoubleClick =
          now - this.lastClickTime < InteractionManager.DOUBLE_CLICK_THRESHOLD &&
          this.lastClickId === hitElement.id;
        this.lastClickTime = now;
        this.lastClickId = hitElement.id;

        if (isDoubleClick) {
          this.handleDoubleClick(hitElement, canvasPoint);
          return;
        }

        // Get all group members if applicable
        const groupIds = getGroupElementIds(hitElement, elements, this.enteredGroupIds);

        if (event.shiftKey) {
          // Add group members to selection
          for (const gid of groupIds) {
            this.callbacks.addToSelection(gid);
          }
        } else if (!selectedIds.has(hitElement.id) || groupIds.length > 1) {
          // If clicking a group member that's not selected, select the whole group
          if (groupIds.length > 1) {
            this.callbacks.selectMultiple(groupIds);
          } else {
            this.callbacks.select(hitElement.id);
          }
        }

        // Start drag
        this.mode = 'dragging';
        const currentSelectedIds = this.callbacks.getSelectedIds();
        this.captureElementPositions(elements, currentSelectedIds);
        this.callbacks.pushHistory();
      } else {
        // Check for double-click on empty area
        const now = Date.now();
        if (now - this.lastClickTime < InteractionManager.DOUBLE_CLICK_THRESHOLD) {
          // Exit any entered groups
          this.enteredGroupIds.clear();
        }
        this.lastClickTime = now;
        this.lastClickId = null;

        // Start selection box
        if (!event.shiftKey) {
          this.callbacks.clearSelection();
        }
        this.mode = 'selecting';
        this.callbacks.startSelectionBox(canvasPoint);
      }
    } else if (tool === 'text') {
      // Text tool: check if clicking on existing text element
      const hitElement = hitTestElements(canvasPoint, elements);
      if (hitElement && hitElement.type === 'text') {
        this.callbacks.select(hitElement.id);
        this.callbacks.startTextEditing(hitElement, false);
      } else {
        // Create new text element at click position
        const newText = this.callbacks.createElement(
          'text',
          this.diagramId,
          canvasPoint.x,
          canvasPoint.y,
          200,
          30,
        );
        this.callbacks.addElement(newText);
        this.callbacks.select(newText.id);
        this.callbacks.startTextEditing(newText, true);
      }
      if (!this.callbacks.isToolLocked()) {
        this.callbacks.resetToSelect();
      }
    } else if (tool === 'freedraw') {
      this.mode = 'drawing-freedraw';
      this.freedrawPoints = [[canvasPoint.x, canvasPoint.y]];
      this.callbacks.pushHistory();
    } else if (SHAPE_TOOLS.has(tool)) {
      this.mode = 'creating';
      this.creatingSeed = Math.floor(Math.random() * 2 ** 31);
      this.creatingId = '';
      this.callbacks.pushHistory();
    }
  }

  onPointerMove(screenX: number, screenY: number): void {
    const viewport = this.callbacks.getViewport();
    const canvasPoint = viewport.screenToCanvas(screenX, screenY);
    const deltaScreenX = screenX - this.lastScreenPoint.x;
    const deltaScreenY = screenY - this.lastScreenPoint.y;

    switch (this.mode) {
      case 'idle': {
        // Hover detection
        const elements = this.callbacks.getElements();
        const hit = hitTestElements(canvasPoint, elements);
        this.callbacks.setHovered(hit?.id ?? null);
        break;
      }

      case 'panning': {
        viewport.pan(deltaScreenX, deltaScreenY);
        this.callbacks.invalidateStatic();
        break;
      }

      case 'creating': {
        const tool = this.callbacks.getActiveTool();

        if (tool === 'arrow' || tool === 'line') {
          const width = canvasPoint.x - this.startCanvasPoint.x;
          const height = canvasPoint.y - this.startCanvasPoint.y;

          this.creatingElement = this.callbacks.createElement(
            tool,
            this.diagramId,
            this.startCanvasPoint.x,
            this.startCanvasPoint.y,
            Math.abs(width),
            Math.abs(height),
          );

          if (this.creatingElement && 'points' in this.creatingElement) {
            (this.creatingElement as LinearElement).points = [
              [0, 0],
              [width, height],
            ];
          }
        } else {
          const x = Math.min(this.startCanvasPoint.x, canvasPoint.x);
          const y = Math.min(this.startCanvasPoint.y, canvasPoint.y);
          const width = Math.abs(canvasPoint.x - this.startCanvasPoint.x);
          const height = Math.abs(canvasPoint.y - this.startCanvasPoint.y);

          if (width > 2 || height > 2) {
            this.creatingElement = this.callbacks.createElement(
              tool,
              this.diagramId,
              x,
              y,
              width,
              height,
            );
          }
        }

        // Stabilize seed and id across frames so rough.js doesn't shimmer
        if (this.creatingElement) {
          if (!this.creatingId) {
            this.creatingId = this.creatingElement.id;
          }
          (this.creatingElement as { id: string }).id = this.creatingId;
          (this.creatingElement as { seed: number }).seed = this.creatingSeed;
        }
        break;
      }

      case 'dragging': {
        const dx = canvasPoint.x - this.startCanvasPoint.x;
        const dy = canvasPoint.y - this.startCanvasPoint.y;

        // Calculate smart guides
        const elements = this.callbacks.getElements();
        const selectedIds = this.callbacks.getSelectedIds();
        const { snappedDx, snappedDy, guides } = this.calculateSmartGuides(
          dx, dy, elements, selectedIds,
        );

        this.currentSmartGuides = guides;

        for (const [id, startPos] of this.dragStartPositions) {
          const element = elements.find((e) => e.id === id);
          if (element && element.boundElements.length > 0) {
            // Use moveElementWithBindings for elements with bindings
            this.callbacks.moveElementWithBindings(
              id,
              startPos.x + snappedDx,
              startPos.y + snappedDy,
            );
          } else {
            this.callbacks.updateElement(id, {
              x: startPos.x + snappedDx,
              y: startPos.y + snappedDy,
            });
          }
        }
        this.callbacks.invalidateStatic();
        break;
      }

      case 'resizing': {
        this.performResize(canvasPoint);
        this.callbacks.invalidateStatic();
        break;
      }

      case 'selecting': {
        this.callbacks.updateSelectionBox(canvasPoint);
        break;
      }

      case 'drawing-freedraw': {
        this.freedrawPoints.push([canvasPoint.x, canvasPoint.y]);
        // Update creating element preview
        if (this.freedrawPoints.length >= 2) {
          const minX = Math.min(...this.freedrawPoints.map((p) => p[0]));
          const minY = Math.min(...this.freedrawPoints.map((p) => p[1]));
          const maxX = Math.max(...this.freedrawPoints.map((p) => p[0]));
          const maxY = Math.max(...this.freedrawPoints.map((p) => p[1]));
          const relativePoints: [number, number][] = this.freedrawPoints.map((p) => [
            p[0] - minX,
            p[1] - minY,
          ]);
          this.creatingElement = {
            ...this.callbacks.createElement('freedraw', this.diagramId, minX, minY, maxX - minX, maxY - minY),
            points: relativePoints,
          } as MavisElement;
        }
        break;
      }
    }

    this.lastScreenPoint = { x: screenX, y: screenY };
  }

  onPointerUp(_screenX: number, _screenY: number): void {
    switch (this.mode) {
      case 'creating': {
        if (this.creatingElement) {
          const tool = this.callbacks.getActiveTool();

          // For arrows, check binding at endpoints
          if ((tool === 'arrow' || tool === 'line') && 'points' in this.creatingElement) {
            const linear = this.creatingElement as LinearElement;
            const elements = this.callbacks.getElements();
            const excludeIds = new Set([this.creatingElement.id]);

            // Check end point binding
            const endPt = linear.points[linear.points.length - 1];
            const endCanvasX = linear.x + endPt[0];
            const endCanvasY = linear.y + endPt[1];
            const endTarget = findBindingTarget(endCanvasX, endCanvasY, elements, excludeIds);

            // Check start point binding
            const startPt = linear.points[0];
            const startCanvasX = linear.x + startPt[0];
            const startCanvasY = linear.y + startPt[1];
            const startTarget = findBindingTarget(startCanvasX, startCanvasY, elements, excludeIds);

            this.callbacks.addElement(this.creatingElement);

            if (endTarget) {
              this.callbacks.bindArrow(
                this.creatingElement.id,
                'end',
                endTarget.element.id,
                endTarget.gap,
              );
            }
            if (startTarget) {
              this.callbacks.bindArrow(
                this.creatingElement.id,
                'start',
                startTarget.element.id,
                startTarget.gap,
              );
            }
          } else if (this.creatingElement.width > 2 || this.creatingElement.height > 2) {
            this.callbacks.addElement(this.creatingElement);
          }

          if (this.creatingElement.width > 2 || this.creatingElement.height > 2 ||
              tool === 'arrow' || tool === 'line') {
            this.callbacks.select(this.creatingElement.id);

            // Portal creation flow: auto-create child diagram
            if (
              this.creatingElement.type === 'portal' &&
              this.callbacks.onPortalCreated
            ) {
              this.callbacks.onPortalCreated(this.creatingElement);
            }

            if (!this.callbacks.isToolLocked()) {
              this.callbacks.resetToSelect();
            }
          }
        }
        this.creatingElement = null;
        this.callbacks.invalidateStatic();
        break;
      }

      case 'dragging': {
        this.dragStartPositions.clear();
        this.currentSmartGuides = [];
        this.callbacks.invalidateStatic();
        break;
      }

      case 'resizing': {
        this.resizeHandle = null;
        this.resizeStartBounds = null;
        this.dragStartPositions.clear();
        this.callbacks.invalidateStatic();
        break;
      }

      case 'selecting': {
        const selBox = this.getSelectionBoxBounds();
        if (selBox && selBox.width > 2 && selBox.height > 2) {
          const elements = this.callbacks.getElements();
          const hits = hitTestSelectionBox(selBox, elements);
          this.callbacks.selectElementsInBox(hits.map((e) => e.id));
        }
        this.callbacks.endSelectionBox();
        break;
      }

      case 'drawing-freedraw': {
        if (this.creatingElement && this.freedrawPoints.length >= 2) {
          // Simplify freedraw points using Ramer-Douglas-Peucker
          const zoom = this.callbacks.getViewport().getViewport().zoom;
          const tolerance = Math.max(1, 2 / zoom);

          const minX = Math.min(...this.freedrawPoints.map((p) => p[0]));
          const minY = Math.min(...this.freedrawPoints.map((p) => p[1]));
          const relativePoints: [number, number][] = this.freedrawPoints.map((p) => [
            p[0] - minX,
            p[1] - minY,
          ]);

          const simplifiedPoints = simplifyTuplePoints(relativePoints, tolerance);

          const finalElement = {
            ...this.creatingElement,
            points: simplifiedPoints,
          } as MavisElement;

          this.callbacks.addElement(finalElement);
          this.callbacks.select(finalElement.id);
          if (!this.callbacks.isToolLocked()) {
            this.callbacks.resetToSelect();
          }
        }
        this.creatingElement = null;
        this.freedrawPoints = [];
        this.callbacks.invalidateStatic();
        break;
      }

      case 'panning':
        break;
    }

    this.mode = 'idle';
  }

  onWheel(screenX: number, screenY: number, deltaX: number, deltaY: number, ctrlKey: boolean): void {
    const viewport = this.callbacks.getViewport();
    if (ctrlKey) {
      // Zoom
      const factor = deltaY > 0 ? 0.9 : 1.1;
      viewport.zoomAt(screenX, screenY, factor);
    } else {
      // Pan
      viewport.pan(-deltaX, -deltaY);
    }
    this.callbacks.invalidateStatic();
  }

  onDoubleClick(screenX: number, screenY: number): void {
    const viewport = this.callbacks.getViewport();
    const canvasPoint = viewport.screenToCanvas(screenX, screenY);
    const elements = this.callbacks.getElements();
    const hitElement = hitTestElements(canvasPoint, elements);

    if (hitElement) {
      this.handleDoubleClick(hitElement, canvasPoint);
    }
  }

  // ─── Double-click handling ────────────────────────────────

  private handleDoubleClick(element: MavisElement, _canvasPoint: Point): void {
    // Double-click on portal: drill down into nested diagram
    if (element.type === 'portal' && this.callbacks.onPortalDrillDown) {
      this.callbacks.onPortalDrillDown(element);
      return;
    }

    // Double-click on text element: start editing
    if (element.type === 'text') {
      this.callbacks.select(element.id);
      this.callbacks.startTextEditing(element, false);
      return;
    }

    // Double-click on a shape: create bound text or enter group
    if (element.groupIds.length > 0) {
      // Check if we should enter the group
      const outermostGroup = element.groupIds[0];
      if (!this.enteredGroupIds.has(outermostGroup)) {
        this.enteredGroupIds.add(outermostGroup);
        this.callbacks.select(element.id);
        return;
      }
    }

    // For shapes without groups (or already entered groups), create bound text
    const shapeTypes = new Set(['rectangle', 'ellipse', 'diamond', 'triangle']);
    if (shapeTypes.has(element.type)) {
      // Check if shape already has bound text
      const hasBoundText = element.boundElements.some((b) => b.type === 'text');
      if (hasBoundText) {
        // Find the bound text element and start editing it
        const elements = this.callbacks.getElements();
        for (const bound of element.boundElements) {
          if (bound.type === 'text') {
            const textEl = elements.find((e) => e.id === bound.id);
            if (textEl && !textEl.isDeleted) {
              this.callbacks.select(textEl.id);
              this.callbacks.startTextEditing(textEl, false);
              return;
            }
          }
        }
      } else {
        // Create new bound text
        this.callbacks.startTextEditing(element, true);
      }
    }
  }

  // ─── Smart Guides ──────────────────────────────────────────

  private calculateSmartGuides(
    dx: number,
    dy: number,
    elements: MavisElement[],
    selectedIds: Set<string>,
  ): { snappedDx: number; snappedDy: number; guides: SmartGuide[] } {
    const guides: SmartGuide[] = [];
    let snappedDx = dx;
    let snappedDy = dy;

    const zoom = this.callbacks.getViewport().getViewport().zoom;
    const threshold = SMART_GUIDE_THRESHOLD / zoom;

    // Get dragging elements bounds
    const draggingBounds = this.getDraggingBounds(dx, dy);
    if (!draggingBounds) return { snappedDx, snappedDy, guides };

    const dragLeft = draggingBounds.x;
    const dragRight = draggingBounds.x + draggingBounds.width;
    const dragCenterX = draggingBounds.x + draggingBounds.width / 2;
    const dragTop = draggingBounds.y;
    const dragBottom = draggingBounds.y + draggingBounds.height;
    const dragCenterY = draggingBounds.y + draggingBounds.height / 2;

    let bestSnapX: { offset: number; guides: SmartGuide[] } | null = null;
    let bestSnapY: { offset: number; guides: SmartGuide[] } | null = null;
    let bestDistX = threshold;
    let bestDistY = threshold;

    // Compare against all non-selected, non-deleted elements
    for (const el of elements) {
      if (selectedIds.has(el.id) || el.isDeleted) continue;

      const elLeft = el.x;
      const elRight = el.x + el.width;
      const elCenterX = el.x + el.width / 2;
      const elTop = el.y;
      const elBottom = el.y + el.height;
      const elCenterY = el.y + el.height / 2;

      // Vertical guides (snap X positions)
      const xSnaps: { dragVal: number; elVal: number }[] = [
        { dragVal: dragLeft, elVal: elLeft },
        { dragVal: dragLeft, elVal: elRight },
        { dragVal: dragLeft, elVal: elCenterX },
        { dragVal: dragRight, elVal: elLeft },
        { dragVal: dragRight, elVal: elRight },
        { dragVal: dragRight, elVal: elCenterX },
        { dragVal: dragCenterX, elVal: elLeft },
        { dragVal: dragCenterX, elVal: elRight },
        { dragVal: dragCenterX, elVal: elCenterX },
      ];

      for (const snap of xSnaps) {
        const dist = Math.abs(snap.dragVal - snap.elVal);
        if (dist < bestDistX) {
          bestDistX = dist;
          const offset = snap.elVal - snap.dragVal;
          const minY = Math.min(dragTop, dragBottom, elTop, elBottom);
          const maxY = Math.max(dragTop, dragBottom, elTop, elBottom);
          bestSnapX = {
            offset,
            guides: [{
              type: 'vertical',
              position: snap.elVal,
              start: minY - 20,
              end: maxY + 20,
            }],
          };
        }
      }

      // Horizontal guides (snap Y positions)
      const ySnaps: { dragVal: number; elVal: number }[] = [
        { dragVal: dragTop, elVal: elTop },
        { dragVal: dragTop, elVal: elBottom },
        { dragVal: dragTop, elVal: elCenterY },
        { dragVal: dragBottom, elVal: elTop },
        { dragVal: dragBottom, elVal: elBottom },
        { dragVal: dragBottom, elVal: elCenterY },
        { dragVal: dragCenterY, elVal: elTop },
        { dragVal: dragCenterY, elVal: elBottom },
        { dragVal: dragCenterY, elVal: elCenterY },
      ];

      for (const snap of ySnaps) {
        const dist = Math.abs(snap.dragVal - snap.elVal);
        if (dist < bestDistY) {
          bestDistY = dist;
          const offset = snap.elVal - snap.dragVal;
          const minX = Math.min(dragLeft, dragRight, elLeft, elRight);
          const maxX = Math.max(dragLeft, dragRight, elLeft, elRight);
          bestSnapY = {
            offset,
            guides: [{
              type: 'horizontal',
              position: snap.elVal,
              start: minX - 20,
              end: maxX + 20,
            }],
          };
        }
      }
    }

    if (bestSnapX) {
      snappedDx = dx + bestSnapX.offset;
      guides.push(...bestSnapX.guides);
    }
    if (bestSnapY) {
      snappedDy = dy + bestSnapY.offset;
      guides.push(...bestSnapY.guides);
    }

    return { snappedDx, snappedDy, guides };
  }

  private getDraggingBounds(dx: number, dy: number): Bounds | null {
    if (this.dragStartPositions.size === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const elements = this.callbacks.getElements();
    for (const [id, startPos] of this.dragStartPositions) {
      const el = elements.find((e) => e.id === id);
      if (!el) continue;

      const newX = startPos.x + dx;
      const newY = startPos.y + dy;
      minX = Math.min(minX, newX);
      minY = Math.min(minY, newY);
      maxX = Math.max(maxX, newX + el.width);
      maxY = Math.max(maxY, newY + el.height);
    }

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  // ─── Helpers ───────────────────────────────────────────────

  private captureElementPositions(elements: MavisElement[], selectedIds: Set<string>): void {
    this.dragStartPositions.clear();
    for (const el of elements) {
      if (selectedIds.has(el.id)) {
        this.dragStartPositions.set(el.id, { x: el.x, y: el.y });
      }
    }
  }

  private getSelectionBounds(
    elements: MavisElement[],
    selectedIds: Set<string>,
  ): Bounds | null {
    const selected = elements.filter((e) => selectedIds.has(e.id));
    if (selected.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of selected) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  private getSelectionBoxBounds(): Bounds | null {
    const viewport = this.callbacks.getViewport();
    const startCanvas = this.startCanvasPoint;
    const endCanvas = viewport.screenToCanvas(
      this.lastScreenPoint.x,
      this.lastScreenPoint.y,
    );
    const x = Math.min(startCanvas.x, endCanvas.x);
    const y = Math.min(startCanvas.y, endCanvas.y);
    const width = Math.abs(endCanvas.x - startCanvas.x);
    const height = Math.abs(endCanvas.y - startCanvas.y);
    return { x, y, width, height };
  }

  private performResize(canvasPoint: Point): void {
    if (!this.resizeHandle || !this.resizeStartBounds) return;

    const dx = canvasPoint.x - this.startCanvasPoint.x;
    const dy = canvasPoint.y - this.startCanvasPoint.y;
    const sb = this.resizeStartBounds;

    for (const [id, startPos] of this.dragStartPositions) {
      // Calculate relative position within selection bounds
      const relX = sb.width > 0 ? (startPos.x - sb.x) / sb.width : 0;
      const relY = sb.height > 0 ? (startPos.y - sb.y) / sb.height : 0;

      let newBoundsX = sb.x;
      let newBoundsY = sb.y;
      let newBoundsW = sb.width;
      let newBoundsH = sb.height;

      // Adjust bounds based on handle
      if (this.resizeHandle.includes('left')) {
        newBoundsX = sb.x + dx;
        newBoundsW = sb.width - dx;
      }
      if (this.resizeHandle.includes('right')) {
        newBoundsW = sb.width + dx;
      }
      if (this.resizeHandle.includes('top')) {
        newBoundsY = sb.y + dy;
        newBoundsH = sb.height - dy;
      }
      if (this.resizeHandle.includes('bottom')) {
        newBoundsH = sb.height + dy;
      }

      // Prevent negative dimensions
      if (newBoundsW < 10) newBoundsW = 10;
      if (newBoundsH < 10) newBoundsH = 10;

      // For single element, directly set position/size
      if (this.dragStartPositions.size === 1) {
        this.callbacks.updateElement(id, {
          x: newBoundsX,
          y: newBoundsY,
          width: newBoundsW,
          height: newBoundsH,
        });
      } else {
        // For multi-element resize, scale proportionally
        const scaleX = sb.width > 0 ? newBoundsW / sb.width : 1;
        const scaleY = sb.height > 0 ? newBoundsH / sb.height : 1;
        this.callbacks.updateElement(id, {
          x: newBoundsX + relX * newBoundsW,
          y: newBoundsY + relY * newBoundsH,
          width: (this.dragStartPositions.get(id)!.x + 100) * scaleX, // approximate
          height: (this.dragStartPositions.get(id)!.y + 100) * scaleY,
        });
      }
    }
  }
}

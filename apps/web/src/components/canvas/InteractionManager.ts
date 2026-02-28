import type { MavisElement, Point, Bounds } from '@mavisdraw/types';
import type { Tool } from '../../stores/toolStore';
import type { ViewportManager } from './ViewportManager';
import {
  hitTestElements,
  hitTestSelectionBox,
  hitTestResizeHandle,
  type ResizeHandle,
} from './HitTesting';

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

  // Tool
  resetToSelect: () => void;
  isToolLocked: () => boolean;

  // Render
  invalidateStatic: () => void;
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

export class InteractionManager {
  private mode: InteractionMode = 'idle';
  private callbacks: InteractionCallbacks;
  private diagramId: string;

  // Tracking state
  private startCanvasPoint: Point = { x: 0, y: 0 };
  private startScreenPoint: Point = { x: 0, y: 0 };
  private lastScreenPoint: Point = { x: 0, y: 0 };
  private creatingElement: MavisElement | null = null;
  private dragStartPositions: Map<string, Point> = new Map();
  private resizeHandle: ResizeHandle | null = null;
  private resizeStartBounds: Bounds | null = null;
  private isSpacePressed = false;
  private freedrawPoints: [number, number][] = [];

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

  setSpacePressed(pressed: boolean): void {
    this.isSpacePressed = pressed;
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

      // Check element hit
      const hitElement = hitTestElements(canvasPoint, elements);
      if (hitElement) {
        if (event.shiftKey) {
          this.callbacks.addToSelection(hitElement.id);
        } else if (!selectedIds.has(hitElement.id)) {
          this.callbacks.select(hitElement.id);
        }
        // Start drag
        this.mode = 'dragging';
        const currentSelectedIds = event.shiftKey
          ? new Set([...selectedIds, hitElement.id])
          : selectedIds.has(hitElement.id)
            ? selectedIds
            : new Set([hitElement.id]);
        this.captureElementPositions(elements, currentSelectedIds);
        this.callbacks.pushHistory();
      } else {
        // Start selection box
        if (!event.shiftKey) {
          this.callbacks.clearSelection();
        }
        this.mode = 'selecting';
        this.callbacks.startSelectionBox(canvasPoint);
      }
    } else if (tool === 'freedraw') {
      this.mode = 'drawing-freedraw';
      this.freedrawPoints = [[canvasPoint.x, canvasPoint.y]];
      this.callbacks.pushHistory();
    } else if (SHAPE_TOOLS.has(tool)) {
      this.mode = 'creating';
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
        const x = Math.min(this.startCanvasPoint.x, canvasPoint.x);
        const y = Math.min(this.startCanvasPoint.y, canvasPoint.y);
        const width = Math.abs(canvasPoint.x - this.startCanvasPoint.x);
        const height = Math.abs(canvasPoint.y - this.startCanvasPoint.y);

        if (width > 2 || height > 2) {
          const tool = this.callbacks.getActiveTool();
          this.creatingElement = this.callbacks.createElement(
            tool,
            this.diagramId,
            x,
            y,
            width,
            height,
          );
        }
        break;
      }

      case 'dragging': {
        const dx = canvasPoint.x - this.startCanvasPoint.x;
        const dy = canvasPoint.y - this.startCanvasPoint.y;
        for (const [id, startPos] of this.dragStartPositions) {
          this.callbacks.updateElement(id, {
            x: startPos.x + dx,
            y: startPos.y + dy,
          });
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
        if (this.creatingElement && this.creatingElement.width > 2 && this.creatingElement.height > 2) {
          this.callbacks.addElement(this.creatingElement);
          this.callbacks.select(this.creatingElement.id);
          if (!this.callbacks.isToolLocked()) {
            this.callbacks.resetToSelect();
          }
        }
        this.creatingElement = null;
        this.callbacks.invalidateStatic();
        break;
      }

      case 'dragging': {
        this.dragStartPositions.clear();
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
        const viewport = this.callbacks.getViewport();
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
          this.callbacks.addElement(this.creatingElement);
          this.callbacks.select(this.creatingElement.id);
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

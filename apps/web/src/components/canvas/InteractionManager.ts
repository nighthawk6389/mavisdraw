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
  hitTestAnchorPoint,
  findNearbyShapeForAnchors,
  hitTestEndpointHandle,
  hitTestMidpointHandle,
  hitTestWaypoint,
  getAnchorPoints,
  hitTestElbowSegment,
  computeElbowPoints,
  type ResizeHandle,
} from './HitTesting';
import { simplifyTuplePoints, applyElbowSegmentDrag } from '@mavisdraw/math';
import type { WheelIntent } from './wheel';

export type InteractionMode =
  | 'idle'
  | 'panning'
  | 'creating'
  | 'creating-from-anchor'
  | 'dragging'
  | 'resizing'
  | 'selecting'
  | 'drawing-freedraw'
  | 'rebinding-endpoint'
  | 'moving-waypoint'
  | 'dragging-elbow-segment';

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
  updateElementSilent: (id: string, updates: Partial<MavisElement>) => void;
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

const RESIZE_CURSORS: Record<ResizeHandle, string> = {
  'top-left': 'nwse-resize',
  'bottom-right': 'nwse-resize',
  'top-right': 'nesw-resize',
  'bottom-left': 'nesw-resize',
  'top-center': 'ns-resize',
  'bottom-center': 'ns-resize',
  'middle-left': 'ew-resize',
  'middle-right': 'ew-resize',
};

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
  private dragStartSizes: Map<string, { width: number; height: number }> = new Map();
  private dragStartPoints: Map<string, [number, number][]> = new Map();
  private shiftKey = false;
  private resizeHandle: ResizeHandle | null = null;
  private resizeStartBounds: Bounds | null = null;
  private isSpacePressed = false;
  private freedrawPoints: [number, number][] = [];
  private freedrawMinX = Infinity;
  private freedrawMinY = Infinity;
  private freedrawMaxX = -Infinity;
  private freedrawMaxY = -Infinity;

  // Smart guides state
  private currentSmartGuides: SmartGuide[] = [];

  // Anchor / connection state (Phase 3)
  private anchorTarget: MavisElement | null = null;
  private hoveredAnchor: string | null = null;
  private anchorSourceElement: MavisElement | null = null;
  private snapTarget: { element: MavisElement; anchor: string } | null = null;

  // Rebinding state (Phase 4)
  private rebindingEnd: 'start' | 'end' | null = null;
  private rebindingArrowId: string = '';
  private rebindingOriginalPoints: [number, number][] = [];

  // Waypoint state (Phase 5)
  private movingWaypointIndex: number = -1;
  private movingWaypointArrowId: string = '';
  private waypointOriginalPoints: [number, number][] = [];

  // Elbow segment drag state
  private elbowSegmentArrowId: string = '';
  private elbowSegmentIndex: number = -1;
  private elbowSegmentOrientation: 'horizontal' | 'vertical' = 'horizontal';
  private elbowSegmentOriginalPoints: [number, number][] = [];

  // Group navigation state
  private enteredGroupIds: Set<string> = new Set();

  // Double-click tracking
  private lastClickTime = 0;
  private lastClickId: string | null = null;
  private lastClickPoint: Point = { x: 0, y: 0 };
  /** Max distance between the two clicks of a double-click, in screen pixels. */
  private static readonly DOUBLE_CLICK_SLOP_PX = 6;
  private static readonly DOUBLE_CLICK_THRESHOLD = 300;

  /** Track last waypoint click for double-click-to-remove (Excalidraw/draw.io style). */
  private lastWaypointClick: { arrowId: string; pointIndex: number; time: number } | null = null;

  // Right-click: a drag pans, a click (no movement) opens the context menu
  private rightButtonDown = false;
  private rightButtonTravel = 0;
  private contextMenuRequested = false;
  private static readonly CLICK_SLOP_PX = 4;

  /** CSS cursor suggested for the current hover position. */
  private hoverCursor = 'default';

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

  /**
   * Handle key down for modes that consume keys (e.g. Delete to remove waypoint).
   * Returns true if the key was handled and should not be processed further.
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (this.mode === 'moving-waypoint' && (event.key === 'Delete' || event.key === 'Backspace')) {
      const elements = this.callbacks.getElements();
      const arrow = elements.find((e) => e.id === this.movingWaypointArrowId) as LinearElement | undefined;
      if (arrow && arrow.points.length > 2 && this.movingWaypointIndex >= 0) {
        const newPoints = [...arrow.points];
        newPoints.splice(this.movingWaypointIndex, 1);
        this.callbacks.pushHistory();
        this.callbacks.updateElement(arrow.id, { points: newPoints } as Partial<LinearElement>);
        this.callbacks.invalidateStatic();
        this.movingWaypointIndex = -1;
        this.movingWaypointArrowId = '';
        this.waypointOriginalPoints = [];
        this.mode = 'idle';
        this.lastWaypointClick = null;
        event.preventDefault();
        return true;
      }
    }
    return false;
  }

  getEnteredGroupIds(): Set<string> {
    return this.enteredGroupIds;
  }

  getAnchorTarget(): MavisElement | null {
    return this.anchorTarget;
  }

  getHoveredAnchor(): string | null {
    return this.hoveredAnchor;
  }

  getSnapTarget(): { element: MavisElement; anchor: string } | null {
    return this.snapTarget;
  }

  // ─── Mouse Events ─────────────────────────────────────────

  onPointerDown(screenX: number, screenY: number, event: { button: number; shiftKey: boolean }): void {
    this.shiftKey = event.shiftKey;
    const viewport = this.callbacks.getViewport();
    const canvasPoint = viewport.screenToCanvas(screenX, screenY);
    this.startCanvasPoint = canvasPoint;
    this.startScreenPoint = { x: screenX, y: screenY };
    this.lastScreenPoint = { x: screenX, y: screenY };

    // Hit radius in canvas units: ~18 screen pixels so handles are easy to click at any zoom
    const zoom = Math.max(0.1, viewport.getViewport().zoom);
    const handleRadius = 18 / zoom;

    // Middle mouse button or space+click = pan
    if (event.button === 1 || this.isSpacePressed || this.callbacks.getActiveTool() === 'hand') {
      this.mode = 'panning';
      return;
    }

    // Any non-primary button breaks a double-click sequence
    if (event.button !== 0) this.resetClickTracking();

    // Right click = pan (Miro-style) or, without movement, context menu
    if (event.button === 2) {
      this.mode = 'panning';
      this.rightButtonDown = true;
      this.rightButtonTravel = 0;
      return;
    }

    const tool = this.callbacks.getActiveTool();
    const elements = this.callbacks.getElements();
    const selectedIds = this.callbacks.getSelectedIds();

    if (tool === 'select' || tool === 'arrow') {
      // Phase 4 & 5: Check endpoint/waypoint/midpoint handles on selected linear elements
      if (tool === 'select' && selectedIds.size > 0) {
        for (const el of elements) {
          if (!selectedIds.has(el.id) || el.isDeleted) continue;
          if (el.type !== 'arrow' && el.type !== 'line') continue;
          if (el.isLocked) continue;
          const linear = el as LinearElement;

          // Phase 4: Endpoint handle hit
          const endpointHit = hitTestEndpointHandle(canvasPoint, linear, handleRadius);
          if (endpointHit) {
            this.mode = 'rebinding-endpoint';
            this.rebindingEnd = endpointHit;
            this.rebindingArrowId = linear.id;
            this.rebindingOriginalPoints = linear.points.map((p) => [...p] as [number, number]);
            this.startCanvasPoint = canvasPoint;
            this.callbacks.pushHistory();
            return;
          }

          // Phase 5: Waypoint handle hit (intermediate points)
          const waypointHit = hitTestWaypoint(canvasPoint, linear, handleRadius);
          if (waypointHit >= 0) {
            const now = Date.now();
            const isDoubleClickRemove =
              this.lastWaypointClick != null &&
              this.lastWaypointClick.arrowId === linear.id &&
              this.lastWaypointClick.pointIndex === waypointHit &&
              now - this.lastWaypointClick.time < InteractionManager.DOUBLE_CLICK_THRESHOLD;

            if (isDoubleClickRemove && linear.points.length > 2) {
              const newPoints = [...linear.points];
              newPoints.splice(waypointHit, 1);
              this.lastWaypointClick = null;
              this.callbacks.pushHistory();
              this.callbacks.updateElement(linear.id, { points: newPoints } as Partial<LinearElement>);
              this.callbacks.invalidateStatic();
              return;
            }

            this.lastWaypointClick = { arrowId: linear.id, pointIndex: waypointHit, time: now };
            this.mode = 'moving-waypoint';
            this.movingWaypointIndex = waypointHit;
            this.movingWaypointArrowId = linear.id;
            this.waypointOriginalPoints = linear.points.map((p) => [...p] as [number, number]);
            this.startCanvasPoint = canvasPoint;
            this.callbacks.pushHistory();
            return;
          }

          // Phase 5: Midpoint + handle hit (add new waypoint) — skip for elbow arrows
          if (linear.routingMode !== 'elbow') {
            const midpointHit = hitTestMidpointHandle(canvasPoint, linear, handleRadius);
            if (midpointHit >= 0) {
              const [x1, y1] = linear.points[midpointHit];
              const [x2, y2] = linear.points[midpointHit + 1];
              const newPoint: [number, number] = [(x1 + x2) / 2, (y1 + y2) / 2];
              const newPoints = [...linear.points];
              newPoints.splice(midpointHit + 1, 0, newPoint);
              this.callbacks.pushHistory();
              this.callbacks.updateElement(linear.id, { points: newPoints } as Partial<LinearElement>);
              this.callbacks.invalidateStatic();
              this.mode = 'moving-waypoint';
              this.movingWaypointIndex = midpointHit + 1;
              this.movingWaypointArrowId = linear.id;
              this.waypointOriginalPoints = newPoints.map((p) => [...p] as [number, number]);
              this.startCanvasPoint = canvasPoint;
              return;
            }
          }

          // Elbow segment drag hit test
          if (linear.routingMode === 'elbow') {
            const elementsMap = new Map<string, MavisElement>();
            for (const e of elements) elementsMap.set(e.id, e);

            const segmentHit = hitTestElbowSegment(canvasPoint, linear, elementsMap);
            if (segmentHit) {
              // Materialize computed route if arrow is auto-routed
              if (!linear.elbowManualRoute || linear.points.length <= 2) {
                const computedPoints = computeElbowPoints(linear, elementsMap);
                this.callbacks.pushHistory();
                this.callbacks.updateElement(linear.id, {
                  points: computedPoints,
                  elbowManualRoute: true,
                } as Partial<LinearElement>);
                this.callbacks.invalidateStatic();

                // Re-read the updated element and re-run hit test
                const updatedElements = this.callbacks.getElements();
                const updatedArrow = updatedElements.find((e) => e.id === linear.id) as LinearElement | undefined;
                if (!updatedArrow) return;

                const updatedMap = new Map<string, MavisElement>();
                for (const e of updatedElements) updatedMap.set(e.id, e);
                const reHit = hitTestElbowSegment(canvasPoint, updatedArrow, updatedMap);
                if (!reHit) return;

                this.mode = 'dragging-elbow-segment';
                this.elbowSegmentArrowId = updatedArrow.id;
                this.elbowSegmentIndex = reHit.segmentIndex;
                this.elbowSegmentOrientation = reHit.orientation;
                this.elbowSegmentOriginalPoints = updatedArrow.points.map((p) => [...p] as [number, number]);
                this.startCanvasPoint = canvasPoint;
                return;
              }

              this.mode = 'dragging-elbow-segment';
              this.elbowSegmentArrowId = linear.id;
              this.elbowSegmentIndex = segmentHit.segmentIndex;
              this.elbowSegmentOrientation = segmentHit.orientation;
              this.elbowSegmentOriginalPoints = linear.points.map((p) => [...p] as [number, number]);
              this.startCanvasPoint = canvasPoint;
              this.callbacks.pushHistory();
              return;
            }
          }
        }
      }

      // Phase 3: Check anchor point hit for edge-initiated connections
      if (this.anchorTarget) {
        const anchorHit = hitTestAnchorPoint(canvasPoint, this.anchorTarget);
        if (anchorHit) {
          const sourceElement = this.anchorTarget;
          const anchors = getAnchorPoints(sourceElement);
          const anchor = anchors.find((a) => a.position === anchorHit);
          if (anchor) {
            this.mode = 'creating-from-anchor';
            this.anchorSourceElement = sourceElement;
            this.startCanvasPoint = { x: anchor.x, y: anchor.y };
            this.creatingSeed = Math.floor(Math.random() * 2 ** 31);
            this.creatingId = '';
            this.callbacks.pushHistory();
            return;
          }
        }
      }

      if (tool === 'arrow') {
        // Standard arrow creation
        this.mode = 'creating';
        this.creatingSeed = Math.floor(Math.random() * 2 ** 31);
        this.creatingId = '';
        this.callbacks.pushHistory();
        return;
      }

      // Check resize handle hit (only for non-linear selections; arrows/lines use their own handles)
      if (selectedIds.size > 0) {
        const hasNonLinear = elements.some(
          (e) => selectedIds.has(e.id) && e.type !== 'arrow' && e.type !== 'line' && !e.isDeleted,
        );
        const hasLocked = elements.some((e) => selectedIds.has(e.id) && e.isLocked);
        if (hasNonLinear && !hasLocked) {
          const selBounds = this.getSelectionBounds(elements, selectedIds);
          if (selBounds) {
            const handle = hitTestResizeHandle(canvasPoint, selBounds, zoom);
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
      }

      // Check element hit (with group awareness)
      const hitElement = hitTestElementsWithGroups(canvasPoint, elements, this.enteredGroupIds);
      if (hitElement) {
        this.lastWaypointClick = null;
        // Check for double-click
        const now = Date.now();
        const isDoubleClick =
          now - this.lastClickTime < InteractionManager.DOUBLE_CLICK_THRESHOLD &&
          this.lastClickId === hitElement.id &&
          Math.hypot(screenX - this.lastClickPoint.x, screenY - this.lastClickPoint.y) <=
            InteractionManager.DOUBLE_CLICK_SLOP_PX;
        this.lastClickTime = now;
        this.lastClickId = hitElement.id;
        this.lastClickPoint = { x: screenX, y: screenY };

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
        this.lastWaypointClick = null;
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
      // Stable seed/id so the sketchy preview doesn't shimmer while drawing
      this.creatingSeed = Math.floor(Math.random() * 2 ** 31);
      this.creatingId = '';
      this.freedrawPoints = [[canvasPoint.x, canvasPoint.y]];
      this.freedrawMinX = canvasPoint.x;
      this.freedrawMinY = canvasPoint.y;
      this.freedrawMaxX = canvasPoint.x;
      this.freedrawMaxY = canvasPoint.y;
      this.callbacks.pushHistory();
    } else if (SHAPE_TOOLS.has(tool)) {
      this.mode = 'creating';
      this.creatingSeed = Math.floor(Math.random() * 2 ** 31);
      this.creatingId = '';
      this.callbacks.pushHistory();
    }
  }

  onPointerMove(screenX: number, screenY: number, modifiers?: { shiftKey: boolean }): void {
    if (modifiers) this.shiftKey = modifiers.shiftKey;
    const viewport = this.callbacks.getViewport();
    const canvasPoint = viewport.screenToCanvas(screenX, screenY);
    const deltaScreenX = screenX - this.lastScreenPoint.x;
    const deltaScreenY = screenY - this.lastScreenPoint.y;

    switch (this.mode) {
      case 'idle': {
        const elements = this.callbacks.getElements();
        const tool = this.callbacks.getActiveTool();

        // Hover detection
        const hit = hitTestElements(canvasPoint, elements);
        this.callbacks.setHovered(hit?.id ?? null);
        this.hoverCursor = this.computeHoverCursor(canvasPoint, elements, hit);

        // Phase 3: Detect nearby shapes for anchor point display
        if (tool === 'select' || tool === 'arrow') {
          const selectedIds = this.callbacks.getSelectedIds();
          const nearbyShape = findNearbyShapeForAnchors(
            canvasPoint.x, canvasPoint.y, elements, selectedIds,
          );
          this.anchorTarget = nearbyShape;
          if (nearbyShape) {
            this.hoveredAnchor = hitTestAnchorPoint(canvasPoint, nearbyShape) ?? null;
          } else {
            this.hoveredAnchor = null;
          }
        } else {
          this.anchorTarget = null;
          this.hoveredAnchor = null;
        }
        break;
      }

      case 'panning': {
        if (this.rightButtonDown) {
          this.rightButtonTravel += Math.hypot(deltaScreenX, deltaScreenY);
          // Don't pan for tiny jitters of a right-click
          if (this.rightButtonTravel < InteractionManager.CLICK_SLOP_PX) break;
        }
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
            this.callbacks.updateElementSilent(id, {
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
        // Update running bounds incrementally (O(1) per frame)
        if (canvasPoint.x < this.freedrawMinX) this.freedrawMinX = canvasPoint.x;
        if (canvasPoint.y < this.freedrawMinY) this.freedrawMinY = canvasPoint.y;
        if (canvasPoint.x > this.freedrawMaxX) this.freedrawMaxX = canvasPoint.x;
        if (canvasPoint.y > this.freedrawMaxY) this.freedrawMaxY = canvasPoint.y;
        // Update creating element preview
        if (this.freedrawPoints.length >= 2) {
          const minX = this.freedrawMinX;
          const minY = this.freedrawMinY;
          const maxX = this.freedrawMaxX;
          const maxY = this.freedrawMaxY;
          const relativePoints: [number, number][] = this.freedrawPoints.map((p) => [
            p[0] - minX,
            p[1] - minY,
          ]);
          const draft = this.callbacks.createElement('freedraw', this.diagramId, minX, minY, maxX - minX, maxY - minY);
          if (!this.creatingId) this.creatingId = draft.id;
          this.creatingElement = {
            ...draft,
            id: this.creatingId,
            seed: this.creatingSeed,
            points: relativePoints,
          } as MavisElement;
        }
        break;
      }

      case 'creating-from-anchor': {
        const width = canvasPoint.x - this.startCanvasPoint.x;
        const height = canvasPoint.y - this.startCanvasPoint.y;

        this.creatingElement = this.callbacks.createElement(
          'arrow',
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

        if (this.creatingElement) {
          if (!this.creatingId) {
            this.creatingId = this.creatingElement.id;
          }
          (this.creatingElement as { id: string }).id = this.creatingId;
          (this.creatingElement as { seed: number }).seed = this.creatingSeed;
        }

        // Check for snap target
        const elements = this.callbacks.getElements();
        const excludeIds = new Set(this.anchorSourceElement ? [this.anchorSourceElement.id] : []);
        const nearbyShape = findNearbyShapeForAnchors(
          canvasPoint.x, canvasPoint.y, elements, excludeIds,
        );
        if (nearbyShape) {
          const anchorHit = hitTestAnchorPoint(canvasPoint, nearbyShape);
          if (anchorHit) {
            this.snapTarget = { element: nearbyShape, anchor: anchorHit };
          } else {
            this.snapTarget = nearbyShape ? { element: nearbyShape, anchor: '' } : null;
          }
        } else {
          this.snapTarget = null;
        }
        break;
      }

      case 'rebinding-endpoint': {
        const elements = this.callbacks.getElements();
        const arrow = elements.find((e) => e.id === this.rebindingArrowId) as LinearElement | undefined;
        if (!arrow) break;

        const newPoints = arrow.points.map((p) => [...p] as [number, number]);
        if (this.rebindingEnd === 'start') {
          newPoints[0] = [canvasPoint.x - arrow.x, canvasPoint.y - arrow.y];
        } else {
          newPoints[newPoints.length - 1] = [canvasPoint.x - arrow.x, canvasPoint.y - arrow.y];
        }

        this.callbacks.updateElementSilent(arrow.id, { points: newPoints } as Partial<LinearElement>);

        // Check for snap target
        const excludeIds = new Set([arrow.id]);
        const nearbyShape = findNearbyShapeForAnchors(
          canvasPoint.x, canvasPoint.y, elements, excludeIds,
        );
        if (nearbyShape) {
          this.snapTarget = { element: nearbyShape, anchor: '' };
          this.anchorTarget = nearbyShape;
        } else {
          this.snapTarget = null;
          this.anchorTarget = null;
        }

        this.callbacks.invalidateStatic();
        break;
      }

      case 'moving-waypoint': {
        const elements = this.callbacks.getElements();
        const arrow = elements.find((e) => e.id === this.movingWaypointArrowId) as LinearElement | undefined;
        if (!arrow) break;

        const newPoints = arrow.points.map((p) => [...p] as [number, number]);
        newPoints[this.movingWaypointIndex] = [
          canvasPoint.x - arrow.x,
          canvasPoint.y - arrow.y,
        ];

        this.callbacks.updateElementSilent(arrow.id, { points: newPoints } as Partial<LinearElement>);
        this.callbacks.invalidateStatic();
        break;
      }

      case 'dragging-elbow-segment': {
        const elements = this.callbacks.getElements();
        const arrow = elements.find((e) => e.id === this.elbowSegmentArrowId) as LinearElement | undefined;
        if (!arrow) break;

        let delta: number;
        if (this.elbowSegmentOrientation === 'horizontal') {
          delta = canvasPoint.y - this.startCanvasPoint.y;
        } else {
          delta = canvasPoint.x - this.startCanvasPoint.x;
        }

        const newPoints = applyElbowSegmentDrag(
          this.elbowSegmentOriginalPoints,
          this.elbowSegmentIndex,
          delta,
        );

        this.callbacks.updateElementSilent(arrow.id, { points: newPoints } as Partial<LinearElement>);
        this.callbacks.invalidateStatic();
        break;
      }
    }

    this.lastScreenPoint = { x: screenX, y: screenY };
  }

  onPointerUp(screenX: number, screenY: number): void {
    // A press that moved was a drag, not the first half of a double-click
    if (
      Math.hypot(screenX - this.startScreenPoint.x, screenY - this.startScreenPoint.y) >
      InteractionManager.DOUBLE_CLICK_SLOP_PX
    ) {
      this.resetClickTracking();
    }

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
        this.dragStartSizes.clear();
        this.currentSmartGuides = [];
        this.callbacks.invalidateStatic();
        break;
      }

      case 'resizing': {
        this.resizeHandle = null;
        this.resizeStartBounds = null;
        this.dragStartPositions.clear();
        this.dragStartSizes.clear();
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

      case 'creating-from-anchor': {
        if (this.creatingElement) {
          const linear = this.creatingElement as LinearElement;
          const elements = this.callbacks.getElements();
          const excludeIds = new Set([this.creatingElement.id]);

          this.callbacks.addElement(this.creatingElement);

          // Bind start to anchor source element
          if (this.anchorSourceElement) {
            this.callbacks.bindArrow(
              this.creatingElement.id,
              'start',
              this.anchorSourceElement.id,
              0,
            );
          }

          // Bind end if snapped to a target
          const endPt = linear.points[linear.points.length - 1];
          const endCanvasX = linear.x + endPt[0];
          const endCanvasY = linear.y + endPt[1];
          const endTarget = findBindingTarget(endCanvasX, endCanvasY, elements, excludeIds);
          if (endTarget) {
            this.callbacks.bindArrow(
              this.creatingElement.id,
              'end',
              endTarget.element.id,
              endTarget.gap,
            );
          }

          this.callbacks.select(this.creatingElement.id);
          if (!this.callbacks.isToolLocked()) {
            this.callbacks.resetToSelect();
          }
        }
        this.creatingElement = null;
        this.anchorSourceElement = null;
        this.snapTarget = null;
        this.anchorTarget = null;
        this.callbacks.invalidateStatic();
        break;
      }

      case 'rebinding-endpoint': {
        const elements = this.callbacks.getElements();
        const arrow = elements.find((e) => e.id === this.rebindingArrowId) as LinearElement | undefined;
        if (arrow && this.rebindingEnd) {
          // Unbind from old target
          this.callbacks.unbindArrow(arrow.id, this.rebindingEnd);

          const excludeIds = new Set([arrow.id]);
          const idx = this.rebindingEnd === 'start' ? 0 : arrow.points.length - 1;
          const ptX = arrow.x + arrow.points[idx][0];
          const ptY = arrow.y + arrow.points[idx][1];
          const newTarget = findBindingTarget(ptX, ptY, elements, excludeIds);
          if (newTarget) {
            this.callbacks.bindArrow(
              arrow.id,
              this.rebindingEnd,
              newTarget.element.id,
              newTarget.gap,
            );
          }
        }
        this.rebindingEnd = null;
        this.rebindingArrowId = '';
        this.rebindingOriginalPoints = [];
        this.snapTarget = null;
        this.anchorTarget = null;
        this.callbacks.invalidateStatic();
        break;
      }

      case 'moving-waypoint': {
        this.movingWaypointIndex = -1;
        this.movingWaypointArrowId = '';
        this.waypointOriginalPoints = [];
        this.callbacks.invalidateStatic();
        break;
      }

      case 'dragging-elbow-segment': {
        this.elbowSegmentArrowId = '';
        this.elbowSegmentIndex = -1;
        this.elbowSegmentOriginalPoints = [];
        this.callbacks.invalidateStatic();
        break;
      }

      case 'panning':
        if (this.rightButtonDown && this.rightButtonTravel < InteractionManager.CLICK_SLOP_PX) {
          this.contextMenuRequested = true;
        }
        break;
    }

    this.rightButtonDown = false;
    this.mode = 'idle';
  }

  /** Forget the previous click so the next one can't complete a double-click. */
  resetClickTracking(): void {
    this.lastClickTime = 0;
    this.lastClickId = null;
  }

  /** True once after a right-click that should open the context menu. */
  consumeContextMenuRequest(): boolean {
    const requested = this.contextMenuRequested;
    this.contextMenuRequested = false;
    return requested;
  }

  /** Abort the current gesture (e.g. a second finger turned it into a pinch). */
  cancelGesture(): void {
    this.mode = 'idle';
    this.creatingElement = null;
    this.currentSmartGuides = [];
    this.rightButtonDown = false;
    this.dragStartPositions.clear();
    this.dragStartSizes.clear();
    this.callbacks.endSelectionBox();
    this.callbacks.invalidateStatic();
  }

  /** Topmost element under a screen point (used by the context menu). */
  hitTestAt(screenX: number, screenY: number): MavisElement | null {
    const canvasPoint = this.callbacks.getViewport().screenToCanvas(screenX, screenY);
    return hitTestElementsWithGroups(canvasPoint, this.callbacks.getElements(), this.enteredGroupIds);
  }

  /** Group-aware set of ids a click on `element` would select. */
  getSelectionFor(element: MavisElement): string[] {
    return getGroupElementIds(element, this.callbacks.getElements(), this.enteredGroupIds);
  }

  getHoverCursor(): string {
    return this.hoverCursor;
  }

  onWheel(screenX: number, screenY: number, intent: WheelIntent): void {
    const viewport = this.callbacks.getViewport();
    if (intent.kind === 'zoom') {
      viewport.zoomAt(screenX, screenY, intent.factor);
    } else if (intent.kind === 'pan') {
      viewport.pan(intent.dx, intent.dy);
    } else {
      return;
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

  private handleDoubleClick(element: MavisElement, canvasPoint: Point): void {
    // Phase 5: Double-click on waypoint to remove it
    if ((element.type === 'arrow' || element.type === 'line') && element.points.length > 2) {
      const linear = element as LinearElement;
      const waypointIdx = hitTestWaypoint(canvasPoint, linear);
      if (waypointIdx >= 0) {
        const newPoints = [...linear.points];
        newPoints.splice(waypointIdx, 1);
        this.callbacks.pushHistory();
        this.callbacks.updateElement(linear.id, { points: newPoints } as Partial<LinearElement>);
        this.callbacks.invalidateStatic();
        return;
      }
    }

    // Double-click on manually-routed elbow: reset to auto-routing
    if (element.type === 'arrow' || element.type === 'line') {
      const linear = element as LinearElement;
      if (linear.routingMode === 'elbow' && linear.elbowManualRoute) {
        const newPoints: [number, number][] = [
          [...linear.points[0]] as [number, number],
          [...linear.points[linear.points.length - 1]] as [number, number],
        ];
        this.callbacks.pushHistory();
        this.callbacks.updateElement(linear.id, {
          points: newPoints,
          elbowManualRoute: false,
        } as Partial<LinearElement>);
        this.callbacks.invalidateStatic();
        return;
      }
    }

    // Phase 2.2: Double-click on arrow/line to cycle routing mode
    if (element.type === 'arrow' || element.type === 'line') {
      const linear = element as LinearElement;
      const modes: ('straight' | 'curved' | 'elbow')[] = ['straight', 'curved', 'elbow'];
      const currentIdx = modes.indexOf(linear.routingMode);
      const nextMode = modes[(currentIdx + 1) % modes.length];
      const updates: Partial<LinearElement> = { routingMode: nextMode };

      // When leaving elbow mode, reset manual routing and collapse to 2 points
      if (linear.routingMode === 'elbow' && linear.elbowManualRoute) {
        updates.elbowManualRoute = false;
        updates.points = [
          [...linear.points[0]] as [number, number],
          [...linear.points[linear.points.length - 1]] as [number, number],
        ];
      }

      this.callbacks.pushHistory();
      this.callbacks.updateElement(linear.id, updates as Partial<LinearElement>);
      this.callbacks.invalidateStatic();
      return;
    }

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

  private computeHoverCursor(
    canvasPoint: Point,
    elements: MavisElement[],
    hit: MavisElement | null,
  ): string {
    if (this.callbacks.getActiveTool() !== 'select') return 'default';
    const selectedIds = this.callbacks.getSelectedIds();
    if (selectedIds.size > 0) {
      const hasLocked = elements.some((e) => selectedIds.has(e.id) && e.isLocked);
      const hasNonLinear = elements.some(
        (e) => selectedIds.has(e.id) && e.type !== 'arrow' && e.type !== 'line',
      );
      if (hasNonLinear && !hasLocked) {
        const bounds = this.getSelectionBounds(elements, selectedIds);
        if (bounds) {
          const zoom = this.callbacks.getViewport().getViewport().zoom;
          const handle = hitTestResizeHandle(canvasPoint, bounds, zoom);
          if (handle) return RESIZE_CURSORS[handle] ?? 'default';
        }
      }
    }
    if (hit) return hit.isLocked ? 'not-allowed' : 'move';
    return 'default';
  }

  private captureElementPositions(elements: MavisElement[], selectedIds: Set<string>): void {
    this.dragStartPositions.clear();
    this.dragStartSizes.clear();
    this.dragStartPoints.clear();
    for (const el of elements) {
      // Locked elements stay put; bound labels move with their container
      if (el.isLocked) continue;
      if (el.type === 'text' && el.containerId && selectedIds.has(el.containerId)) continue;
      if (selectedIds.has(el.id)) {
        this.dragStartPositions.set(el.id, { x: el.x, y: el.y });
        this.dragStartSizes.set(el.id, { width: el.width, height: el.height });
        if (el.type === 'freedraw' || el.type === 'line' || el.type === 'arrow') {
          this.dragStartPoints.set(el.id, el.points.map((p) => [p[0], p[1]] as [number, number]));
        }
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

    const handle = this.resizeHandle;
    const dx = canvasPoint.x - this.startCanvasPoint.x;
    const dy = canvasPoint.y - this.startCanvasPoint.y;
    const sb = this.resizeStartBounds;
    const MIN = 10;

    let x = sb.x;
    let y = sb.y;
    let w = sb.width;
    let h = sb.height;

    if (handle.includes('left')) w = sb.width - dx;
    if (handle.includes('right')) w = sb.width + dx;
    if (handle.startsWith('top')) h = sb.height - dy;
    if (handle.startsWith('bottom')) h = sb.height + dy;
    w = Math.max(MIN, w);
    h = Math.max(MIN, h);

    // Shift keeps proportions; images keep them by default
    const isCorner = !handle.includes('center') && !handle.includes('middle');
    const elements = this.callbacks.getElements();
    const allImages = Array.from(this.dragStartPositions.keys()).every(
      (id) => elements.find((e) => e.id === id)?.type === 'image',
    );
    if (isCorner && (this.shiftKey || allImages) && sb.width > 0 && sb.height > 0) {
      const ratio = sb.width / sb.height;
      if (w / sb.width > h / sb.height) h = w / ratio;
      else w = h * ratio;
    }

    // Anchor the edge opposite to the dragged handle
    if (handle.includes('left')) x = sb.x + sb.width - w;
    if (handle.startsWith('top')) y = sb.y + sb.height - h;

    const scaleX = sb.width > 0 ? w / sb.width : 1;
    const scaleY = sb.height > 0 ? h / sb.height : 1;

    for (const [id, startPos] of this.dragStartPositions) {
      const startSize = this.dragStartSizes.get(id) ?? { width: MIN, height: MIN };
      const updates: Partial<LinearElement> = {
        x: x + (startPos.x - sb.x) * scaleX,
        y: y + (startPos.y - sb.y) * scaleY,
        width: Math.max(1, startSize.width * scaleX),
        height: Math.max(1, startSize.height * scaleY),
      };
      const startPoints = this.dragStartPoints.get(id);
      if (startPoints) {
        updates.points = startPoints.map(([px, py]) => [px * scaleX, py * scaleY] as [number, number]);
      }
      this.callbacks.updateElementSilent(id, updates as Partial<MavisElement>);
    }
  }
}

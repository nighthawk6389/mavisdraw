import type { MavisElement, Point, Bounds, LinearElement } from '@mavisdraw/types';
import type { Tool } from '../../stores/toolStore';
import type { ViewportManager } from './ViewportManager';
import {
  hitTestElements,
  hitTestSelectionBox,
  hitTestTransformHandle,
  findBindingTarget,
  hitTestElementsWithGroups,
  getGroupElementIds,
  hitTestEraser,
  hitTestLasso,
  hitTestAnchorPoint,
  findNearbyShapeForAnchors,
  hitTestEndpointHandle,
  hitTestMidpointHandle,
  hitTestWaypoint,
  getAnchorPoints,
  hitTestElbowSegment,
  computeElbowPoints,
  getVisualBounds,
  selectionFrame,
  frameContainsPoint,
  unionVisualBounds,
  type ResizeHandle,
  type SelectionFrame,
} from './HitTesting';
import { simplifyTuplePoints, applyElbowSegmentDrag } from '@mavisdraw/math';
import type { WheelIntent } from './wheel';
import {
  creationBox,
  dominantAxis,
  exceedsDragThreshold,
  handleSides,
  lockToAxis,
  placedBox,
  normalizeAngle,
  resizeBox,
  resizeRotatedBox,
  resizeSnapCandidates,
  rotatePoint,
  rotationDelta,
  scaleElementBox,
  snapVectorAngle,
} from './gestures/transform';
import {
  SNAP_DISTANCE_PX,
  alignmentGuides,
  createSnapContext,
  snapMovingBox,
  snapToGrid,
  snapValues,
  type SnapContext,
  type SnapGuide,
} from './gestures/snapping';

export type InteractionMode =
  | 'idle'
  | 'panning'
  | 'creating'
  | 'creating-from-anchor'
  | 'dragging'
  | 'resizing'
  | 'rotating'
  | 'selecting'
  | 'drawing-freedraw'
  | 'rebinding-endpoint'
  | 'moving-waypoint'
  | 'pending-waypoint'
  | 'dragging-elbow-segment'
  | 'erasing'
  | 'lasso';

/** Keyboard modifiers held during a pointer gesture. */
export interface PointerModifiers {
  shiftKey: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export interface PointerDownInfo extends PointerModifiers {
  button: number;
  /** 'mouse' | 'pen' | 'touch' — coarse pointers get a larger drag threshold. */
  pointerType?: string;
}

export interface ElementUpdate {
  id: string;
  changes: Partial<MavisElement>;
}

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
  /** Many updates as one store change, no undo step of its own (drag, resize). */
  updateElementsSilent: (updates: ElementUpdate[]) => void;
  deleteSelectedElements: () => void;
  /** Delete these elements as one undo step (the eraser). */
  eraseElements?: (ids: string[]) => void;
  pushHistory: () => void;
  /** Copy elements in place, labels included (Alt-drag). Returns the copies. */
  duplicateElements?: (ids: string[]) => MavisElement[];
  /** Remove never-committed elements entirely (a cancelled Alt-drag's copies). */
  discardElements?: (ids: string[]) => void;

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

  // Snapping
  /** Grid size to snap to, or null when snapping to the grid is off. */
  getGridSnap?: () => number | null;
  /** Smart guides on (the default); Ctrl/Cmd still skips snapping for one gesture. */
  isObjectSnapEnabled?: () => boolean;
  /** The canvas-space rectangle on screen: only shapes you can see are snap targets. */
  getVisibleBounds?: () => Bounds | null;

  // Render
  invalidateStatic: () => void;

  // Portal drill-down
  onPortalDrillDown?: (portalElement: MavisElement) => void;

  /** Viewers can look, select and drill in, but not change anything. */
  isReadOnly?: () => boolean;
  onPortalCreated?: (portalElement: MavisElement) => void;
}

const SHAPE_TOOLS = new Set<Tool>([
  'rectangle',
  'ellipse',
  'diamond',
  'cylinder',
  'queue',
  'line',
  'arrow',
  'freedraw',
  'text',
  'portal',
]);

/** The eraser's reach around the pointer, and how finely its path is followed (screen px). */
const ERASER_RADIUS_PX = 6;
const ERASER_STEP_PX = 4;
/** How long the eraser's trail stays visible. */
const ERASER_TRAIL_MS = 200;

/** Tools that draw a box: a click places one at its default size. */
const BOX_TOOLS = new Set<Tool>(['rectangle', 'ellipse', 'diamond', 'cylinder', 'queue', 'portal']);

/** Direction each handle pulls in, degrees clockwise from "right" (y points down). */
const HANDLE_DIRECTION_DEG: Record<ResizeHandle, number> = {
  'middle-right': 0,
  'bottom-right': 45,
  'bottom-center': 90,
  'bottom-left': 135,
  'middle-left': 180,
  'top-left': 225,
  'top-center': 270,
  'top-right': 315,
};
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

/** Resize cursor for a handle, turned with a rotated frame. */
function resizeCursor(handle: ResizeHandle, angle: number): string {
  const degrees = HANDLE_DIRECTION_DEG[handle] + (angle * 180) / Math.PI;
  return RESIZE_CURSORS[((Math.round(degrees / 45) % 4) + 4) % 4];
}

function isLinearType(type: string): boolean {
  return type === 'arrow' || type === 'line' || type === 'freedraw';
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

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
  private resizeHandle: ResizeHandle | null = null;
  private resizeStartBounds: Bounds | null = null;
  /** Angle of a single rotated shape being resized (its frame turns with it). */
  private resizeAngle = 0;
  /** Pivot of a rotation gesture (centre of the selection frame). */
  private rotationCentre: Point = { x: 0, y: 0 };
  /** Angle of a single shape when its rotation started (Shift snaps its result). */
  private rotationBase = 0;
  private isSpacePressed = false;
  private freedrawPoints: [number, number][] = [];
  private freedrawMinX = Infinity;
  private freedrawMinY = Infinity;
  private freedrawMaxX = -Infinity;
  private freedrawMaxY = -Infinity;

  // Modifiers and pointer kind of the current gesture
  private mods: Required<PointerModifiers> = {
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  };
  private pointerType = 'mouse';

  /** The press has moved past the drag threshold (drag / create gestures). */
  private dragActive = false;
  /** Elements as they were when the gesture started (Escape restores them). */
  private gestureOriginals: Map<string, MavisElement> = new Map();
  /** Selection when the press started (Escape / cancelled marquee restore it). */
  private selectionAtPress: string[] = [];
  /** Union bounds of what's being moved, at the start of the drag. */
  private dragStartBounds: Bounds | null = null;
  /** Copies made by an Alt-drag (discarded if the drag is cancelled). */
  private duplicateIds: string[] = [];
  /** Shift-click on a selected element: deselect it if the press doesn't turn into a drag. */
  private pendingDeselect: string[] | null = null;
  /** Click on one element of a multi-selection: select just it unless it turns into a drag. */
  private pendingSelectOnly: string[] | null = null;
  /** The press landed on empty space inside the selection frame. */
  private pressedOnFrame = false;
  /** Where a shape being drawn started (snapped). */
  private creationOrigin: Point = { x: 0, y: 0 };
  /** Selection kept by a Shift-marquee. */
  private marqueeBase: Set<string> = new Set();
  private lastMarqueeKey = '';

  // Smart guides state
  private snapContext: SnapContext | null = null;
  private currentSmartGuides: SnapGuide[] = [];

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

  /** Segment whose "+" handle was pressed; a bend is inserted once the pointer moves. */
  private pendingWaypointSegment = -1;

  // Elbow segment drag state
  private elbowSegmentArrowId: string = '';
  private elbowSegmentIndex: number = -1;
  private elbowSegmentOrientation: 'horizontal' | 'vertical' = 'horizontal';
  private elbowSegmentOriginalPoints: [number, number][] = [];

  // Group navigation state
  private enteredGroupIds: Set<string> = new Set();

  /** Eraser: what the trail has passed over (shown faded, deleted on release). */
  private erasing: Set<string> = new Set();
  private erasingVersion = 0;
  private eraserTrail: Array<{ x: number; y: number; t: number }> = [];
  private lastEraserPoint: Point | null = null;
  /** Lasso selection (Alt+drag on empty canvas): the loop drawn so far. */
  private lassoPath: Point[] = [];

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

  /** Alignment and spacing guides to draw for the current gesture. */
  getSmartGuides(): SnapGuide[] {
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

  /** What the eraser will delete on release; `version` changes whenever the set does. */
  getErasing(): { ids: ReadonlySet<string>; version: number } {
    return { ids: this.erasing, version: this.erasingVersion };
  }

  /** The lasso being drawn (canvas points), empty when none. */
  getLassoPath(): Point[] {
    return this.mode === 'lasso' ? this.lassoPath : [];
  }

  /** The eraser's recent path (canvas points), drawn as a fading trail. */
  getEraserTrail(): Point[] {
    if (this.mode !== 'erasing') return [];
    const now = performance.now();
    return this.eraserTrail.filter((p) => now - p.t < ERASER_TRAIL_MS);
  }

  /** A pointer gesture is under way (something Escape could cancel). */
  isGestureActive(): boolean {
    return this.mode !== 'idle' && this.mode !== 'panning';
  }

  /** The current gesture benefits from auto-panning at the canvas edge. */
  wantsEdgeScroll(): boolean {
    switch (this.mode) {
      case 'dragging':
      case 'creating':
        return this.dragActive;
      case 'resizing':
      case 'selecting':
      case 'lasso':
      case 'creating-from-anchor':
      case 'rebinding-endpoint':
      case 'moving-waypoint':
      case 'dragging-elbow-segment':
        return true;
      default:
        return false;
    }
  }

  /** Last pointer position, canvas-relative screen pixels. */
  getLastScreenPoint(): Point {
    return this.lastScreenPoint;
  }

  /**
   * Modifier keys changed mid-gesture without the pointer moving (pressing
   * Shift to lock an axis, Ctrl to stop snapping): re-apply the gesture.
   */
  onModifiersChange(mods: PointerModifiers): void {
    this.setModifiers(mods);
    if (!this.isGestureActive()) return;
    this.onPointerMove(this.lastScreenPoint.x, this.lastScreenPoint.y);
  }

  private setModifiers(mods: PointerModifiers): void {
    this.mods = {
      shiftKey: mods.shiftKey,
      altKey: mods.altKey ?? false,
      ctrlKey: mods.ctrlKey ?? false,
      metaKey: mods.metaKey ?? false,
    };
  }

  /** Ctrl/Cmd held: place freely, without snapping (Miro, tldraw, Excalidraw). */
  private isSnapEnabled(): boolean {
    return !(this.mods.ctrlKey || this.mods.metaKey);
  }

  private snapThreshold(): number {
    return SNAP_DISTANCE_PX / Math.max(0.01, this.callbacks.getViewport().getViewport().zoom);
  }

  private gridSize(): number | null {
    const size = this.callbacks.getGridSnap?.() ?? null;
    return size && size > 0 ? size : null;
  }

  // ─── Mouse Events ─────────────────────────────────────────

  onPointerDown(screenX: number, screenY: number, event: PointerDownInfo): void {
    this.setModifiers(event);
    this.pointerType = event.pointerType ?? 'mouse';
    this.dragActive = false;
    this.pendingDeselect = null;
    this.pendingSelectOnly = null;
    this.pressedOnFrame = false;
    this.duplicateIds = [];
    this.gestureOriginals = new Map();
    this.snapContext = null;
    this.currentSmartGuides = [];
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

    if (this.callbacks.isReadOnly?.()) {
      this.onReadOnlyPointerDown(screenX, screenY, canvasPoint, event.shiftKey);
      return;
    }

    const tool = this.callbacks.getActiveTool();
    const elements = this.callbacks.getElements();
    const selectedIds = this.callbacks.getSelectedIds();
    this.selectionAtPress = Array.from(selectedIds);

    if (tool === 'eraser') {
      this.mode = 'erasing';
      this.erasing = new Set();
      this.erasingVersion++;
      this.eraserTrail = [{ ...canvasPoint, t: performance.now() }];
      this.lastEraserPoint = canvasPoint;
      this.eraseAlong(canvasPoint, canvasPoint);
      return;
    }

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

          // Phase 5: Midpoint + handle — drag it to add a bend; double-click
          // there (where the label sits) edits the connector's label
          if (linear.routingMode !== 'elbow') {
            const midpointHit = hitTestMidpointHandle(canvasPoint, linear, handleRadius);
            if (midpointHit >= 0) {
              const now = Date.now();
              const isDoubleClick =
                now - this.lastClickTime < InteractionManager.DOUBLE_CLICK_THRESHOLD &&
                this.lastClickId === linear.id &&
                Math.hypot(screenX - this.lastClickPoint.x, screenY - this.lastClickPoint.y) <=
                  InteractionManager.DOUBLE_CLICK_SLOP_PX;
              this.lastClickTime = now;
              this.lastClickId = linear.id;
              this.lastClickPoint = { x: screenX, y: screenY };
              if (isDoubleClick) {
                this.handleDoubleClick(linear, canvasPoint);
                return;
              }
              this.mode = 'pending-waypoint';
              this.pendingWaypointSegment = midpointHit;
              this.movingWaypointArrowId = linear.id;
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
        this.startCreating(canvasPoint, tool);
        return;
      }

      // Rotation and resize handles of the selection frame (exactly where they're drawn)
      const frame = this.getSelectionFrame(elements, selectedIds);
      if (frame && !elements.some((e) => selectedIds.has(e.id) && e.isLocked)) {
        const hit = hitTestTransformHandle(canvasPoint, frame, zoom, this.pointerType !== 'mouse');
        if (hit?.kind === 'rotate') {
          this.mode = 'rotating';
          const b = frame.bounds;
          this.rotationCentre = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
          this.rotationBase = frame.angle;
          this.captureElementPositions(elements, selectedIds);
          this.callbacks.pushHistory();
          return;
        }
        if (hit?.kind === 'resize') {
          this.mode = 'resizing';
          this.resizeHandle = hit.handle;
          this.resizeStartBounds = frame.bounds;
          this.resizeAngle = frame.angle;
          this.captureElementPositions(elements, selectedIds);
          this.snapContext = frame.angle ? null : this.buildSnapContext(selectedIds);
          this.callbacks.pushHistory();
          return;
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
        const alreadySelected = selectedIds.has(hitElement.id);

        if (event.shiftKey) {
          if (alreadySelected) {
            // Shift-click toggles: deselect on release, unless this becomes a drag
            this.pendingDeselect = groupIds;
          } else {
            for (const gid of groupIds) this.callbacks.addToSelection(gid);
          }
        } else if (!alreadySelected) {
          // If clicking a group member that's not selected, select the whole group
          if (groupIds.length > 1) {
            this.callbacks.selectMultiple(groupIds);
          } else {
            this.callbacks.select(hitElement.id);
          }
        } else if (selectedIds.size > groupIds.length) {
          // Pressing one shape of a bigger selection keeps the selection for a
          // drag; a plain click selects just that shape (Figma, tldraw, Excalidraw)
          this.pendingSelectOnly = groupIds;
        }

        // Start drag (it begins moving once the pointer passes the threshold)
        this.mode = 'dragging';
        this.captureElementPositions(elements, this.callbacks.getSelectedIds());
        this.callbacks.pushHistory();
        return;
      }

      this.lastWaypointClick = null;
      // Check for double-click on empty area
      const now = Date.now();
      if (now - this.lastClickTime < InteractionManager.DOUBLE_CLICK_THRESHOLD) {
        // Exit any entered groups
        this.enteredGroupIds.clear();
      }
      this.lastClickTime = now;
      this.lastClickId = null;

      // Empty space inside the selection frame grabs the whole selection
      // (Excalidraw, tldraw, Figma); a click there without dragging deselects
      if (frame && !event.shiftKey && this.frameContains(frame, canvasPoint, zoom)) {
        this.pressedOnFrame = true;
        this.mode = 'dragging';
        this.captureElementPositions(elements, selectedIds);
        this.callbacks.pushHistory();
        return;
      }

      // Start selection box (Alt: a freeform lasso)
      this.marqueeBase = event.shiftKey ? new Set(selectedIds) : new Set();
      this.lastMarqueeKey = '';
      if (!event.shiftKey) {
        this.callbacks.clearSelection();
      }
      if (event.altKey) {
        this.mode = 'lasso';
        this.lassoPath = [canvasPoint];
        return;
      }
      this.mode = 'selecting';
      this.callbacks.startSelectionBox(canvasPoint);
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
      this.startCreating(canvasPoint, tool);
    }
  }

  onPointerMove(screenX: number, screenY: number, modifiers?: PointerModifiers): void {
    if (modifiers) this.setModifiers(modifiers);
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
        if (!this.dragActive) {
          if (!exceedsDragThreshold(this.startScreenPoint, { x: screenX, y: screenY }, this.pointerType)) {
            break;
          }
          this.dragActive = true;
        }
        this.updateCreatingElement(canvasPoint);
        break;
      }

      case 'dragging': {
        if (!this.dragActive) {
          if (!exceedsDragThreshold(this.startScreenPoint, { x: screenX, y: screenY }, this.pointerType)) {
            break;
          }
          this.beginDrag();
        }
        this.applyDrag(canvasPoint);
        break;
      }

      case 'resizing': {
        this.performResize(canvasPoint);
        this.callbacks.invalidateStatic();
        break;
      }

      case 'rotating': {
        this.performRotation(canvasPoint);
        this.callbacks.invalidateStatic();
        break;
      }

      case 'selecting': {
        this.callbacks.updateSelectionBox(canvasPoint);
        this.updateMarqueeSelection(canvasPoint);
        break;
      }

      case 'lasso': {
        const last = this.lassoPath[this.lassoPath.length - 1];
        const zoom = Math.max(0.1, viewport.getViewport().zoom);
        // A point every couple of screen pixels is plenty
        if (!last || Math.hypot(canvasPoint.x - last.x, canvasPoint.y - last.y) * zoom >= 2) {
          this.lassoPath = [...this.lassoPath, canvasPoint];
          this.updateLassoSelection();
        }
        break;
      }

      case 'erasing': {
        this.eraseAlong(this.lastEraserPoint ?? canvasPoint, canvasPoint);
        this.lastEraserPoint = canvasPoint;
        const now = performance.now();
        this.eraserTrail.push({ ...canvasPoint, t: now });
        // Only the last moments are drawn
        while (this.eraserTrail.length > 2 && now - this.eraserTrail[0].t > ERASER_TRAIL_MS) {
          this.eraserTrail.shift();
        }
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
        let width = canvasPoint.x - this.startCanvasPoint.x;
        let height = canvasPoint.y - this.startCanvasPoint.y;
        if (this.mods.shiftKey) {
          const snapped = snapVectorAngle({ x: width, y: height });
          width = snapped.x;
          height = snapped.y;
        }

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

      case 'pending-waypoint': {
        const moved = Math.hypot(screenX - this.startScreenPoint.x, screenY - this.startScreenPoint.y);
        if (moved < InteractionManager.DOUBLE_CLICK_SLOP_PX) break;
        const elements = this.callbacks.getElements();
        const arrow = elements.find((e) => e.id === this.movingWaypointArrowId) as LinearElement | undefined;
        if (!arrow) break;
        const newPoints = arrow.points.map((p) => [...p] as [number, number]);
        newPoints.splice(this.pendingWaypointSegment + 1, 0, [
          canvasPoint.x - arrow.x,
          canvasPoint.y - arrow.y,
        ]);
        this.callbacks.updateElementSilent(arrow.id, { points: newPoints } as Partial<LinearElement>);
        this.mode = 'moving-waypoint';
        this.movingWaypointIndex = this.pendingWaypointSegment + 1;
        this.waypointOriginalPoints = arrow.points.map((p) => [...p] as [number, number]);
        this.pendingWaypointSegment = -1;
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
      case 'lasso': {
        this.updateLassoSelection();
        this.lassoPath = [];
        this.mode = 'idle';
        return;
      }

      case 'erasing': {
        const ids = Array.from(this.erasing);
        this.clearEraser();
        this.mode = 'idle';
        if (ids.length > 0) this.callbacks.eraseElements?.(ids);
        this.callbacks.invalidateStatic();
        return;
      }

      case 'creating': {
        const tool = this.callbacks.getActiveTool();
        if (this.creatingElement) {
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
            this.finishCreation(this.creatingElement);
          } else if (this.creatingElement.width > 2 || this.creatingElement.height > 2) {
            this.callbacks.addElement(this.creatingElement);
            this.finishCreation(this.creatingElement);
          }
        } else if (!this.dragActive && BOX_TOOLS.has(tool)) {
          // A click places a shape of the default size, centred on the pointer
          const box = placedBox(tool, this.creationOrigin);
          const grid = this.isSnapEnabled() ? this.gridSize() : null;
          if (grid) {
            box.x = snapToGrid(box.x, grid);
            box.y = snapToGrid(box.y, grid);
          }
          const placed = this.callbacks.createElement(tool, this.diagramId, box.x, box.y, box.width, box.height);
          this.callbacks.addElement(placed);
          this.finishCreation(placed);
        }
        this.creatingElement = null;
        this.snapContext = null;
        this.currentSmartGuides = [];
        this.callbacks.invalidateStatic();
        break;
      }

      case 'dragging': {
        if (!this.dragActive) {
          // A click, not a drag
          if (this.pendingDeselect) {
            const drop = new Set(this.pendingDeselect);
            this.callbacks.selectMultiple(
              Array.from(this.callbacks.getSelectedIds()).filter((id) => !drop.has(id)),
            );
          } else if (this.pendingSelectOnly) {
            this.callbacks.selectMultiple(this.pendingSelectOnly);
          } else if (this.pressedOnFrame) {
            this.callbacks.clearSelection();
          }
        }
        this.endTransformGesture();
        break;
      }

      case 'resizing': {
        this.resizeHandle = null;
        this.resizeStartBounds = null;
        this.resizeAngle = 0;
        this.endTransformGesture();
        break;
      }

      case 'rotating': {
        this.endTransformGesture();
        break;
      }

      case 'selecting': {
        this.updateMarqueeSelection(
          this.callbacks.getViewport().screenToCanvas(this.lastScreenPoint.x, this.lastScreenPoint.y),
        );
        this.callbacks.endSelectionBox();
        break;
      }

      case 'drawing-freedraw': {
        if (this.creatingElement && this.freedrawPoints.length >= 2) {
          // Simplify freedraw points using Ramer-Douglas-Peucker
          const zoom = this.callbacks.getViewport().getViewport().zoom;
          const tolerance = Math.max(1, 2 / zoom);

          const minX = this.freedrawMinX;
          const minY = this.freedrawMinY;
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

      case 'pending-waypoint':
        this.pendingWaypointSegment = -1;
        this.movingWaypointArrowId = '';
        break;

      case 'panning':
        if (this.rightButtonDown && this.rightButtonTravel < InteractionManager.CLICK_SLOP_PX) {
          this.contextMenuRequested = true;
        }
        break;
    }

    this.rightButtonDown = false;
    this.dragActive = false;
    this.mode = 'idle';
  }

  /** Read-only pointer handling: select, box-select and drill into portals. */
  private onReadOnlyPointerDown(screenX: number, screenY: number, canvasPoint: Point, shiftKey: boolean): void {
    const elements = this.callbacks.getElements();
    this.selectionAtPress = Array.from(this.callbacks.getSelectedIds());
    const hit = hitTestElementsWithGroups(canvasPoint, elements, this.enteredGroupIds);
    if (!hit) {
      this.marqueeBase = shiftKey ? new Set(this.callbacks.getSelectedIds()) : new Set();
      this.lastMarqueeKey = '';
      if (!shiftKey) this.callbacks.clearSelection();
      this.mode = 'selecting';
      this.callbacks.startSelectionBox(canvasPoint);
      this.resetClickTracking();
      return;
    }
    const now = Date.now();
    const isDoubleClick =
      now - this.lastClickTime < InteractionManager.DOUBLE_CLICK_THRESHOLD &&
      this.lastClickId === hit.id &&
      Math.hypot(screenX - this.lastClickPoint.x, screenY - this.lastClickPoint.y) <=
        InteractionManager.DOUBLE_CLICK_SLOP_PX;
    this.lastClickTime = now;
    this.lastClickId = hit.id;
    this.lastClickPoint = { x: screenX, y: screenY };
    if (isDoubleClick && hit.type === 'portal') {
      this.callbacks.onPortalDrillDown?.(hit);
      return;
    }
    const groupIds = getGroupElementIds(hit, elements, this.enteredGroupIds);
    if (shiftKey) groupIds.forEach((id) => this.callbacks.addToSelection(id));
    else this.callbacks.selectMultiple(groupIds);
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

  private clearEraser(): void {
    this.erasing = new Set();
    this.erasingVersion++;
    this.eraserTrail = [];
    this.lastEraserPoint = null;
  }

  /**
   * Mark what the eraser passes over between two points (Alt held: unmark).
   * A label counts as its shape, a grouped shape takes its group, and a
   * shape takes its label; locked shapes are left alone.
   */
  private eraseAlong(from: Point, to: Point): void {
    const zoom = Math.max(0.1, this.callbacks.getViewport().getViewport().zoom);
    const radius = ERASER_RADIUS_PX / zoom;
    const step = ERASER_STEP_PX / zoom;
    const elements = this.callbacks.getElements();
    const map = new Map(elements.map((el) => [el.id, el] as const));
    // Only what's near the segment is tested at each step
    const minX = Math.min(from.x, to.x) - radius;
    const maxX = Math.max(from.x, to.x) + radius;
    const minY = Math.min(from.y, to.y) - radius;
    const maxY = Math.max(from.y, to.y) + radius;
    const near = elements.filter((el) => {
      if (el.isDeleted || el.isLocked) return false;
      const b = getVisualBounds(el);
      return b.x <= maxX && b.x + b.width >= minX && b.y <= maxY && b.y + b.height >= minY;
    });
    if (near.length === 0) return;
    const restoring = this.mods.altKey;
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step));
    let changed = false;
    for (let i = 0; i <= steps; i++) {
      const p = {
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
      };
      for (const el of near) {
        if (!hitTestEraser(p, el, map, radius)) continue;
        let target = el;
        if (el.type === 'text' && el.containerId) {
          const container = map.get(el.containerId);
          if (container && !container.isDeleted) target = container;
        }
        if (target.isLocked) continue;
        for (const id of getGroupElementIds(target, elements, this.enteredGroupIds)) {
          const member = map.get(id);
          if (!member || member.isLocked) continue;
          const ids = [id, ...member.boundElements.filter((b) => b.type === 'text').map((b) => b.id)];
          for (const eraseId of ids) {
            if (restoring ? this.erasing.delete(eraseId) : !this.erasing.has(eraseId)) {
              if (!restoring) this.erasing.add(eraseId);
              changed = true;
            }
          }
        }
      }
    }
    if (changed) {
      this.erasingVersion++;
      this.callbacks.invalidateStatic();
    }
  }

  /**
   * Abort the current gesture and put everything back as it was before it
   * started (Escape, or a second finger turning it into a pinch). The open
   * undo step ends up empty, so nothing is left to undo.
   */
  cancelGesture(): void {
    const mode = this.mode;
    if (
      (mode === 'dragging' || mode === 'resizing' || mode === 'rotating') &&
      this.gestureOriginals.size > 0
    ) {
      this.callbacks.updateElementsSilent(
        Array.from(this.gestureOriginals.values()).map((el) => ({ id: el.id, changes: el })),
      );
    }
    if (this.duplicateIds.length > 0) {
      this.callbacks.discardElements?.(this.duplicateIds);
      this.callbacks.selectMultiple(this.selectionAtPress);
      this.duplicateIds = [];
    }
    const restorePoints = (id: string, points: [number, number][]) => {
      if (id && points.length > 0) {
        this.callbacks.updateElementSilent(id, { points } as Partial<LinearElement>);
      }
    };
    if (mode === 'rebinding-endpoint') restorePoints(this.rebindingArrowId, this.rebindingOriginalPoints);
    if (mode === 'moving-waypoint') restorePoints(this.movingWaypointArrowId, this.waypointOriginalPoints);
    if (mode === 'dragging-elbow-segment') {
      restorePoints(this.elbowSegmentArrowId, this.elbowSegmentOriginalPoints);
    }
    if (mode === 'selecting' || mode === 'lasso') {
      this.callbacks.selectMultiple(this.selectionAtPress);
    }
    this.lassoPath = [];
    if (mode === 'erasing') {
      // Nothing was deleted yet: the faded shapes just come back
      this.clearEraser();
      this.callbacks.invalidateStatic();
    }

    this.mode = 'idle';
    this.dragActive = false;
    this.resizeHandle = null;
    this.resizeStartBounds = null;
    this.resizeAngle = 0;
    this.creatingElement = null;
    this.anchorSourceElement = null;
    this.snapTarget = null;
    this.freedrawPoints = [];
    this.currentSmartGuides = [];
    this.snapContext = null;
    this.rightButtonDown = false;
    this.dragStartPositions.clear();
    this.dragStartSizes.clear();
    this.dragStartPoints.clear();
    this.gestureOriginals = new Map();
    this.pendingDeselect = null;
    this.pendingSelectOnly = null;
    this.pressedOnFrame = false;
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

    // Double-click on a connector: add or edit its label ("REST", "publishes"...).
    // Routing mode and route reset live in the context menu / style panel.
    if (element.type === 'arrow' || element.type === 'line') {
      this.callbacks.startTextEditing(element, false);
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
    const shapeTypes = new Set(['rectangle', 'ellipse', 'diamond', 'triangle', 'cylinder', 'queue']);
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

  // ─── Creating ──────────────────────────────────────────────

  private startCreating(canvasPoint: Point, tool: Tool): void {
    this.mode = 'creating';
    this.creatingSeed = Math.floor(Math.random() * 2 ** 31);
    this.creatingId = '';
    this.creatingElement = null;
    const linear = tool === 'arrow' || tool === 'line';
    // Shapes snap to other shapes; connectors leave that to binding
    this.snapContext = linear ? null : this.buildSnapContext(new Set());
    this.creationOrigin = this.snapCreationPoint(canvasPoint, !linear);
    this.callbacks.pushHistory();
  }

  /** Snap a corner of a shape being drawn to other shapes and, if on, the grid. */
  private snapCreationPoint(point: Point, toObjects: boolean): Point {
    if (!this.isSnapEnabled()) return point;
    const result = { ...point };
    let snappedX = false;
    let snappedY = false;
    if (toObjects && this.snapContext) {
      const hit = snapValues(this.snapContext, [point.x], [point.y], this.snapThreshold());
      if (hit.x) {
        result.x += hit.x.offset;
        snappedX = true;
      }
      if (hit.y) {
        result.y += hit.y.offset;
        snappedY = true;
      }
    }
    const grid = this.gridSize();
    if (grid) {
      if (!snappedX) result.x = snapToGrid(result.x, grid);
      if (!snappedY) result.y = snapToGrid(result.y, grid);
    }
    return result;
  }

  private updateCreatingElement(canvasPoint: Point): void {
    const tool = this.callbacks.getActiveTool();
    const origin = this.creationOrigin;

    if (tool === 'arrow' || tool === 'line') {
      const end = this.snapCreationPoint(canvasPoint, false);
      let width = end.x - origin.x;
      let height = end.y - origin.y;
      // Shift: 15° steps (horizontal, vertical, 45°…)
      if (this.mods.shiftKey) {
        const snapped = snapVectorAngle({ x: width, y: height });
        width = snapped.x;
        height = snapped.y;
      }

      this.creatingElement = this.callbacks.createElement(
        tool,
        this.diagramId,
        origin.x,
        origin.y,
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
      const corner = this.snapCreationPoint(canvasPoint, true);
      const box = creationBox(origin, corner, {
        keepAspect: this.mods.shiftKey,
        fromCenter: this.mods.altKey,
      });
      this.creatingElement = this.callbacks.createElement(
        tool,
        this.diagramId,
        box.x,
        box.y,
        Math.max(1, box.width),
        Math.max(1, box.height),
      );
      this.currentSmartGuides =
        this.snapContext && this.isSnapEnabled() ? alignmentGuides(this.snapContext, box) : [];
    }

    // Stabilize seed and id across frames so rough.js doesn't shimmer
    if (this.creatingElement) {
      if (!this.creatingId) {
        this.creatingId = this.creatingElement.id;
      }
      (this.creatingElement as { id: string }).id = this.creatingId;
      (this.creatingElement as { seed: number }).seed = this.creatingSeed;
    }
  }

  /** Select a newly created element, hand portals their child diagram, leave the tool. */
  private finishCreation(element: MavisElement): void {
    this.callbacks.select(element.id);
    if (element.type === 'portal' && this.callbacks.onPortalCreated) {
      this.callbacks.onPortalCreated(element);
    }
    if (!this.callbacks.isToolLocked()) {
      this.callbacks.resetToSelect();
    }
  }

  // ─── Moving ────────────────────────────────────────────────

  /** The press became a drag: Alt duplicates first, then the snap targets are fixed. */
  private beginDrag(): void {
    this.dragActive = true;
    this.pendingDeselect = null;
    this.pendingSelectOnly = null;

    if (this.mods.altKey && this.callbacks.duplicateElements && this.dragStartPositions.size > 0) {
      // Alt-drag leaves the originals in place and drags copies (Excalidraw, tldraw, Miro, Figma)
      const copies = this.callbacks.duplicateElements(Array.from(this.dragStartPositions.keys()));
      if (copies.length > 0) {
        this.duplicateIds = copies.map((c) => c.id);
        const copyIds = new Set(this.duplicateIds);
        const topLevel = copies
          .filter((c) => !(c.type === 'text' && c.containerId && copyIds.has(c.containerId)))
          .map((c) => c.id);
        this.callbacks.selectMultiple(topLevel);
        this.captureElementPositions(copies, new Set(topLevel));
        // The originals never move, so Escape only has to drop the copies
        this.gestureOriginals = new Map();
      }
    }

    const moving = new Set(this.dragStartPositions.keys());
    for (const id of this.callbacks.getSelectedIds()) moving.add(id);
    this.snapContext = this.buildSnapContext(moving);
  }

  private applyDrag(canvasPoint: Point): void {
    let delta = {
      x: canvasPoint.x - this.startCanvasPoint.x,
      y: canvasPoint.y - this.startCanvasPoint.y,
    };
    let axes = { x: true, y: true };
    if (this.mods.shiftKey) {
      // Shift locks the move to the dominant axis
      const axis = dominantAxis(delta);
      delta = lockToAxis(delta);
      axes = { x: axis === 'x', y: axis === 'y' };
    }

    this.currentSmartGuides = [];
    const start = this.dragStartBounds;
    if (start && this.isSnapEnabled()) {
      let snappedX = false;
      let snappedY = false;
      if (this.snapContext) {
        const moved = { ...start, x: start.x + delta.x, y: start.y + delta.y };
        const snap = snapMovingBox(this.snapContext, moved, this.snapThreshold(), axes);
        delta = { x: delta.x + snap.offset.x, y: delta.y + snap.offset.y };
        this.currentSmartGuides = snap.guides;
        snappedX = snap.guides.some((g) => g.axis === 'x');
        snappedY = snap.guides.some((g) => g.axis === 'y');
      }
      // The grid only applies where no shape claimed the position (tldraw)
      const grid = this.gridSize();
      if (grid) {
        if (axes.x && !snappedX) delta.x = snapToGrid(start.x + delta.x, grid) - start.x;
        if (axes.y && !snappedY) delta.y = snapToGrid(start.y + delta.y, grid) - start.y;
      }
    }

    const updates: ElementUpdate[] = [];
    for (const [id, pos] of this.dragStartPositions) {
      updates.push({ id, changes: { x: pos.x + delta.x, y: pos.y + delta.y } });
    }
    if (updates.length > 0) this.callbacks.updateElementsSilent(updates);
    this.callbacks.invalidateStatic();
  }

  private endTransformGesture(): void {
    this.dragStartPositions.clear();
    this.dragStartSizes.clear();
    this.dragStartPoints.clear();
    this.gestureOriginals = new Map();
    this.dragStartBounds = null;
    this.duplicateIds = [];
    this.snapContext = null;
    this.currentSmartGuides = [];
    this.pendingDeselect = null;
    this.pendingSelectOnly = null;
    this.pressedOnFrame = false;
    this.callbacks.invalidateStatic();
  }

  // ─── Marquee ───────────────────────────────────────────────

  /** Live marquee selection: what's under the rectangle is selected while dragging. */
  /** Select what the lasso encloses (plus what was selected with Shift held). */
  private updateLassoSelection(): void {
    const ids = new Set(this.marqueeBase);
    for (const el of hitTestLasso(this.lassoPath, this.callbacks.getElements())) ids.add(el.id);
    const list = Array.from(ids);
    const key = list.join(',');
    if (key === this.lastMarqueeKey) return;
    this.lastMarqueeKey = key;
    this.callbacks.selectElementsInBox(list);
  }

  private updateMarqueeSelection(canvasPoint: Point): void {
    const start = this.startCanvasPoint;
    const box = {
      x: Math.min(start.x, canvasPoint.x),
      y: Math.min(start.y, canvasPoint.y),
      width: Math.abs(canvasPoint.x - start.x),
      height: Math.abs(canvasPoint.y - start.y),
    };
    const ids = new Set(this.marqueeBase);
    if (box.width > 2 && box.height > 2) {
      const mode = this.mods.ctrlKey || this.mods.metaKey ? 'contain' : 'intersect';
      for (const el of hitTestSelectionBox(box, this.callbacks.getElements(), mode)) ids.add(el.id);
    }
    const list = Array.from(ids);
    const key = list.join(',');
    if (key === this.lastMarqueeKey) return;
    this.lastMarqueeKey = key;
    this.callbacks.selectElementsInBox(list);
  }

  // ─── Snapping ──────────────────────────────────────────────

  /**
   * Snap targets: shapes on screen that aren't moving (connectors and labels
   * excluded). Null when snapping to objects is switched off.
   */
  private buildSnapContext(exclude: Set<string>): SnapContext | null {
    if (this.callbacks.isObjectSnapEnabled?.() === false) return null;
    const visible = this.callbacks.getVisibleBounds?.() ?? null;
    const references: Bounds[] = [];
    for (const el of this.callbacks.getElements()) {
      if (el.isDeleted || exclude.has(el.id) || isLinearType(el.type)) continue;
      if (el.type === 'text' && el.containerId) continue;
      const b = getVisualBounds(el);
      if (visible && !boundsOverlap(b, visible)) continue;
      references.push(b);
    }
    return createSnapContext(references);
  }

  // ─── Helpers ───────────────────────────────────────────────

  private getSelectionFrame(elements: MavisElement[], selectedIds: Set<string>): SelectionFrame | null {
    if (selectedIds.size === 0) return null;
    return selectionFrame(elements.filter((e) => selectedIds.has(e.id)));
  }

  /** Inside the drawn selection outline (which sits a few pixels outside the bounds). */
  private frameContains(frame: SelectionFrame, point: Point, zoom: number): boolean {
    return frameContainsPoint(frame, point, zoom);
  }

  private computeHoverCursor(
    canvasPoint: Point,
    elements: MavisElement[],
    hit: MavisElement | null,
  ): string {
    if (this.callbacks.getActiveTool() !== 'select') return 'default';
    const selectedIds = this.callbacks.getSelectedIds();
    const frame = this.getSelectionFrame(elements, selectedIds);
    const zoom = this.callbacks.getViewport().getViewport().zoom;
    const hasLocked = selectedIds.size > 0 && elements.some((e) => selectedIds.has(e.id) && e.isLocked);
    if (frame && !hasLocked) {
      const handle = hitTestTransformHandle(canvasPoint, frame, zoom);
      if (handle?.kind === 'rotate') return 'grab';
      if (handle) return resizeCursor(handle.handle, frame.angle);
    }
    if (hit) return hit.isLocked ? 'not-allowed' : 'move';
    if (frame && !hasLocked && this.frameContains(frame, canvasPoint, zoom)) return 'move';
    return 'default';
  }

  // ─── Rotating ──────────────────────────────────────────────

  /**
   * Turn the selection around the centre of its frame. A single shape gets
   * a new `angle`; in a multi-selection every shape also orbits the centre.
   * Connectors and ink have their points turned instead (their hit-testing
   * and bindings work on points). Shift snaps to 15° steps.
   */
  private performRotation(canvasPoint: Point): void {
    const centre = this.rotationCentre;
    const delta = rotationDelta(
      centre,
      this.startCanvasPoint,
      canvasPoint,
      this.rotationBase,
      this.mods.shiftKey,
    );
    const updates: ElementUpdate[] = [];
    for (const [id, original] of this.gestureOriginals) {
      if (isLinearType(original.type)) {
        const points = (original as LinearElement).points.map(([px, py]) =>
          rotatePoint({ x: original.x + px, y: original.y + py }, centre, delta),
        );
        if (points.length === 0) continue;
        if (original.type === 'freedraw') {
          // Ink keeps its origin at the top-left of its points
          const minX = Math.min(...points.map((p) => p.x));
          const minY = Math.min(...points.map((p) => p.y));
          const maxX = Math.max(...points.map((p) => p.x));
          const maxY = Math.max(...points.map((p) => p.y));
          updates.push({
            id,
            changes: {
              x: minX,
              y: minY,
              width: maxX - minX,
              height: maxY - minY,
              points: points.map((p) => [p.x - minX, p.y - minY] as [number, number]),
            } as Partial<MavisElement>,
          });
        } else {
          const origin = points[0];
          updates.push({
            id,
            changes: {
              x: origin.x,
              y: origin.y,
              points: points.map((p) => [p.x - origin.x, p.y - origin.y] as [number, number]),
            } as Partial<MavisElement>,
          });
        }
        continue;
      }
      const ownCentre = rotatePoint(
        { x: original.x + original.width / 2, y: original.y + original.height / 2 },
        centre,
        delta,
      );
      updates.push({
        id,
        changes: {
          x: ownCentre.x - original.width / 2,
          y: ownCentre.y - original.height / 2,
          angle: normalizeAngle((original.angle ?? 0) + delta),
        },
      });
    }
    if (updates.length > 0) this.callbacks.updateElementsSilent(updates);
  }

  private captureElementPositions(elements: MavisElement[], selectedIds: Set<string>): void {
    this.dragStartPositions.clear();
    this.dragStartSizes.clear();
    this.dragStartPoints.clear();
    this.gestureOriginals = new Map();
    const moving: MavisElement[] = [];
    for (const el of elements) {
      // Locked elements stay put; bound labels move with their container
      if (el.isLocked) continue;
      if (el.type === 'text' && el.containerId && selectedIds.has(el.containerId)) continue;
      if (selectedIds.has(el.id)) {
        moving.push(el);
        this.gestureOriginals.set(el.id, el);
        this.dragStartPositions.set(el.id, { x: el.x, y: el.y });
        this.dragStartSizes.set(el.id, { width: el.width, height: el.height });
        if (el.type === 'freedraw' || el.type === 'line' || el.type === 'arrow') {
          this.dragStartPoints.set(el.id, el.points.map((p) => [p[0], p[1]] as [number, number]));
        }
      }
    }
    this.dragStartBounds = unionVisualBounds(moving);
  }

  private performResize(canvasPoint: Point): void {
    if (!this.resizeHandle || !this.resizeStartBounds) return;

    const handle = this.resizeHandle;
    const sb = this.resizeStartBounds;
    let delta = {
      x: canvasPoint.x - this.startCanvasPoint.x,
      y: canvasPoint.y - this.startCanvasPoint.y,
    };

    // Shift keeps proportions; images keep them by default on corners and never flip
    const isCorner = !handle.includes('center') && !handle.includes('middle');
    const types = Array.from(this.gestureOriginals.values()).map((el) => el.type);
    const allImages = types.length > 0 && types.every((t) => t === 'image');
    const anyImage = types.some((t) => t === 'image');
    const keepAspect = this.mods.shiftKey || (allImages && isCorner);
    const fromCenter = this.mods.altKey;

    this.currentSmartGuides = [];
    if (this.resizeAngle) {
      // A single rotated shape: resize in its own frame, opposite handle stays put
      const [id] = Array.from(this.dragStartPositions.keys());
      if (!id) return;
      const box = resizeRotatedBox(sb, this.resizeAngle, handle, delta, {
        keepAspect,
        fromCenter,
        minSize: 1,
        noFlip: anyImage,
      });
      this.callbacks.updateElementsSilent([{ id, changes: box }]);
      return;
    }
    const snapping = this.isSnapEnabled() && !keepAspect;
    if (snapping) {
      const candidates = resizeSnapCandidates(sb, handle, delta, fromCenter);
      let snappedX = false;
      let snappedY = false;
      if (this.snapContext) {
        const hit = snapValues(
          this.snapContext,
          candidates.x.values,
          candidates.y.values,
          this.snapThreshold(),
        );
        if (hit.x) {
          delta = { ...delta, x: delta.x + hit.x.offset * candidates.x.k[hit.x.index] };
          snappedX = true;
        }
        if (hit.y) {
          delta = { ...delta, y: delta.y + hit.y.offset * candidates.y.k[hit.y.index] };
          snappedY = true;
        }
      }
      const grid = this.gridSize();
      if (grid) {
        const edgeX = candidates.x.values[0];
        const edgeY = candidates.y.values[0];
        if (!snappedX && edgeX !== undefined) delta = { ...delta, x: delta.x + snapToGrid(edgeX, grid) - edgeX };
        if (!snappedY && edgeY !== undefined) delta = { ...delta, y: delta.y + snapToGrid(edgeY, grid) - edgeY };
      }
    }

    const result = resizeBox(sb, handle, delta, {
      keepAspect,
      fromCenter,
      minSize: 1,
      noFlip: anyImage,
    });

    if (snapping && this.snapContext) {
      // Guides for the edges being dragged
      const { h, v } = handleSides(handle);
      const mapX = (value: number) => result.originX + (value - result.originX) * result.scaleX;
      const mapY = (value: number) => result.originY + (value - result.originY) * result.scaleY;
      const xs =
        h === 0
          ? []
          : fromCenter
            ? [result.box.x, result.box.x + result.box.width]
            : [mapX(h > 0 ? sb.x + sb.width : sb.x)];
      const ys =
        v === 0
          ? []
          : fromCenter
            ? [result.box.y, result.box.y + result.box.height]
            : [mapY(v > 0 ? sb.y + sb.height : sb.y)];
      this.currentSmartGuides = alignmentGuides(this.snapContext, result.box, { only: { xs, ys } });
    }

    const updates: ElementUpdate[] = [];
    for (const [id, startPos] of this.dragStartPositions) {
      const startSize = this.dragStartSizes.get(id) ?? { width: 1, height: 1 };
      const next = scaleElementBox(
        { x: startPos.x, y: startPos.y, width: startSize.width, height: startSize.height },
        result,
        this.dragStartPoints.get(id),
      );
      updates.push({ id, changes: next as Partial<MavisElement> });
    }
    if (updates.length > 0) this.callbacks.updateElementsSilent(updates);
  }
}

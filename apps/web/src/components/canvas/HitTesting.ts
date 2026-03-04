import type { MavisElement, Point, Bounds, LinearElement } from '@mavisdraw/types';
import { getCubicControlPoints, cubicPoint, calculateElbowRoute, getConnectionSide } from '@mavisdraw/math';

const HANDLE_SIZE = 8;
const HIT_TOLERANCE = 5;

export type ResizeHandle =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface HitResult {
  elementId: string;
  type: 'body' | 'resize-handle' | 'rotation-handle';
  handle?: ResizeHandle;
}

/**
 * Get the element bounds considering its position and size.
 */
function getElementBounds(element: MavisElement): Bounds {
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
}

/**
 * Transform a point into the element's local coordinate system
 * (accounting for rotation around the element center).
 */
function toLocalCoords(point: Point, element: MavisElement): Point {
  if (element.angle === 0) {
    return { x: point.x - element.x, y: point.y - element.y };
  }
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const cos = Math.cos(-element.angle);
  const sin = Math.sin(-element.angle);
  const dx = point.x - cx;
  const dy = point.y - cy;
  return {
    x: dx * cos - dy * sin + element.width / 2,
    y: dx * sin + dy * cos + element.height / 2,
  };
}

/**
 * Test if a point hits a rectangle element.
 */
function hitTestRectangle(local: Point, element: MavisElement): boolean {
  const tolerance = HIT_TOLERANCE + element.strokeWidth / 2;
  return (
    local.x >= -tolerance &&
    local.x <= element.width + tolerance &&
    local.y >= -tolerance &&
    local.y <= element.height + tolerance
  );
}

/**
 * Test if a point hits an ellipse element.
 */
function hitTestEllipse(local: Point, element: MavisElement): boolean {
  const rx = element.width / 2;
  const ry = element.height / 2;
  const dx = local.x - rx;
  const dy = local.y - ry;
  const tolerance = HIT_TOLERANCE + element.strokeWidth / 2;
  const outerRx = rx + tolerance;
  const outerRy = ry + tolerance;
  return (dx * dx) / (outerRx * outerRx) + (dy * dy) / (outerRy * outerRy) <= 1;
}

/**
 * Test if a point hits a diamond element.
 */
function hitTestDiamond(local: Point, element: MavisElement): boolean {
  const hw = element.width / 2;
  const hh = element.height / 2;
  const dx = Math.abs(local.x - hw);
  const dy = Math.abs(local.y - hh);
  const tolerance = HIT_TOLERANCE + element.strokeWidth / 2;
  return dx / (hw + tolerance) + dy / (hh + tolerance) <= 1;
}

/**
 * Test if a point is near a polyline defined by points.
 */
function hitTestPolyline(canvasPoint: Point, element: MavisElement, elementsMap?: Map<string, MavisElement>): boolean {
  const linear = element as LinearElement;
  if (!linear.points || linear.points.length < 2) return false;

  const tolerance = HIT_TOLERANCE + element.strokeWidth / 2;

  if (linear.routingMode === 'curved') {
    return hitTestCurvedLine(canvasPoint, linear, tolerance);
  }

  if (linear.routingMode === 'elbow') {
    return hitTestElbowLine(canvasPoint, linear, tolerance, elementsMap);
  }

  for (let i = 0; i < linear.points.length - 1; i++) {
    const [x1, y1] = linear.points[i];
    const [x2, y2] = linear.points[i + 1];
    const ax = element.x + x1;
    const ay = element.y + y1;
    const bx = element.x + x2;
    const by = element.y + y2;
    const dist = distanceToSegment(canvasPoint, { x: ax, y: ay }, { x: bx, y: by });
    if (dist <= tolerance) return true;
  }
  return false;
}

function hitTestCurvedLine(canvasPoint: Point, linear: LinearElement, tolerance: number): boolean {
  const pts: Point[] = linear.points.map(([px, py]) => ({
    x: linear.x + px,
    y: linear.y + py,
  }));

  if (pts.length === 2) {
    const [p0, cp1, cp2, p3] = getCubicControlPoints(pts[0], pts[1], 0.5);
    const SAMPLES = 20;
    let prevPt = p0;
    for (let i = 1; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const pt = cubicPoint(p0, cp1, cp2, p3, t);
      const dist = distanceToSegment(canvasPoint, prevPt, pt);
      if (dist <= tolerance) return true;
      prevPt = pt;
    }
    return false;
  }

  // Multi-point curved line: test each smooth segment
  const segments = computeSmoothCurveSegments(pts);
  const SAMPLES = 12;
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    const segStart = s === 0 ? pts[0] : segments[s - 1].end;
    let prevPt = segStart;
    for (let i = 1; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const pt = cubicPoint(segStart, seg.cp1, seg.cp2, seg.end, t);
      const dist = distanceToSegment(canvasPoint, prevPt, pt);
      if (dist <= tolerance) return true;
      prevPt = pt;
    }
  }
  return false;
}

/**
 * Compute smooth cubic bezier segments through ordered points (Catmull-Rom tangents).
 * Shared logic for hit testing - mirrors CanvasRenderer.computeSmoothCurveSegments.
 */
function computeSmoothCurveSegments(
  pts: Point[],
): { cp1: Point; cp2: Point; end: Point }[] {
  const n = pts.length;
  if (n < 2) return [];

  const tension = 0.35;
  const tangents: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tangents.push({ x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y });
    } else if (i === n - 1) {
      tangents.push({ x: pts[n - 1].x - pts[n - 2].x, y: pts[n - 1].y - pts[n - 2].y });
    } else {
      tangents.push({
        x: (pts[i + 1].x - pts[i - 1].x) / 2,
        y: (pts[i + 1].y - pts[i - 1].y) / 2,
      });
    }
  }

  const segments: { cp1: Point; cp2: Point; end: Point }[] = [];
  for (let i = 0; i < n - 1; i++) {
    segments.push({
      cp1: {
        x: pts[i].x + tangents[i].x * tension,
        y: pts[i].y + tangents[i].y * tension,
      },
      cp2: {
        x: pts[i + 1].x - tangents[i + 1].x * tension,
        y: pts[i + 1].y - tangents[i + 1].y * tension,
      },
      end: pts[i + 1],
    });
  }
  return segments;
}

function hitTestElbowLine(
  canvasPoint: Point,
  linear: LinearElement,
  tolerance: number,
  elementsMap?: Map<string, MavisElement>,
): boolean {
  const start: [number, number] = [
    linear.x + linear.points[0][0],
    linear.y + linear.points[0][1],
  ];
  const end: [number, number] = [
    linear.x + linear.points[linear.points.length - 1][0],
    linear.y + linear.points[linear.points.length - 1][1],
  ];

  let startDir = null as ReturnType<typeof getConnectionSide> | null;
  let endDir = null as ReturnType<typeof getConnectionSide> | null;

  if (elementsMap && linear.startBinding) {
    const bound = elementsMap.get(linear.startBinding.elementId);
    if (bound) {
      startDir = getConnectionSide(start[0], start[1], bound.x, bound.y, bound.width, bound.height);
    }
  }

  if (elementsMap && linear.endBinding) {
    const bound = elementsMap.get(linear.endBinding.elementId);
    if (bound) {
      endDir = getConnectionSide(end[0], end[1], bound.x, bound.y, bound.width, bound.height);
    }
  }

  const elbowPoints = calculateElbowRoute(start, end, startDir, endDir);

  for (let i = 0; i < elbowPoints.length - 1; i++) {
    const a = { x: elbowPoints[i][0], y: elbowPoints[i][1] };
    const b = { x: elbowPoints[i + 1][0], y: elbowPoints[i + 1][1] };
    const dist = distanceToSegment(canvasPoint, a, b);
    if (dist <= tolerance) return true;
  }
  return false;
}

/**
 * Distance from a point to a line segment.
 */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Test if a point hits a text element (simple bounding box).
 */
function hitTestText(local: Point, element: MavisElement): boolean {
  return (
    local.x >= 0 &&
    local.x <= element.width &&
    local.y >= 0 &&
    local.y <= element.height
  );
}

/**
 * Hit test a single element against a canvas-coordinate point.
 */
export function hitTestElement(canvasPoint: Point, element: MavisElement, elementsMap?: Map<string, MavisElement>): boolean {
  if (element.isDeleted) return false;

  // For linear elements, use polyline testing directly in canvas space
  if (element.type === 'line' || element.type === 'arrow' || element.type === 'freedraw') {
    return hitTestPolyline(canvasPoint, element, elementsMap);
  }

  const local = toLocalCoords(canvasPoint, element);

  switch (element.type) {
    case 'rectangle':
    case 'image':
    case 'portal':
      return hitTestRectangle(local, element);
    case 'ellipse':
      return hitTestEllipse(local, element);
    case 'diamond':
    case 'triangle':
      return hitTestDiamond(local, element);
    case 'text':
      return hitTestText(local, element);
    default:
      return hitTestRectangle(local, element);
  }
}

/**
 * Find the topmost element hit at a canvas-coordinate point.
 * Elements are ordered by layerIndex (last = top).
 */
export function hitTestElements(
  canvasPoint: Point,
  elements: MavisElement[],
): MavisElement | null {
  // Build map for elbow routing lookups
  const map = new Map<string, MavisElement>();
  for (const el of elements) map.set(el.id, el);

  // Iterate in reverse to find topmost element first
  for (let i = elements.length - 1; i >= 0; i--) {
    if (hitTestElement(canvasPoint, elements[i], map)) {
      return elements[i];
    }
  }
  return null;
}

/**
 * Find all elements within a selection rectangle (canvas coordinates).
 */
export function hitTestSelectionBox(
  selectionBounds: Bounds,
  elements: MavisElement[],
): MavisElement[] {
  return elements.filter((element) => {
    if (element.isDeleted) return false;
    const eb = getElementBounds(element);
    return boundsOverlap(selectionBounds, eb);
  });
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Get the resize handle positions for a set of selected elements.
 */
export function getResizeHandles(bounds: Bounds): { handle: ResizeHandle; x: number; y: number }[] {
  const { x, y, width, height } = bounds;
  const hs = HANDLE_SIZE / 2;
  return [
    { handle: 'top-left', x: x - hs, y: y - hs },
    { handle: 'top-center', x: x + width / 2 - hs, y: y - hs },
    { handle: 'top-right', x: x + width - hs, y: y - hs },
    { handle: 'middle-left', x: x - hs, y: y + height / 2 - hs },
    { handle: 'middle-right', x: x + width - hs, y: y + height / 2 - hs },
    { handle: 'bottom-left', x: x - hs, y: y + height - hs },
    { handle: 'bottom-center', x: x + width / 2 - hs, y: y + height - hs },
    { handle: 'bottom-right', x: x + width - hs, y: y + height - hs },
  ];
}

/**
 * Test if a point hits a resize handle. Returns the handle if hit, null otherwise.
 */
export function hitTestResizeHandle(
  canvasPoint: Point,
  selectionBounds: Bounds,
): ResizeHandle | null {
  const handles = getResizeHandles(selectionBounds);
  for (const h of handles) {
    if (
      canvasPoint.x >= h.x &&
      canvasPoint.x <= h.x + HANDLE_SIZE &&
      canvasPoint.y >= h.y &&
      canvasPoint.y <= h.y + HANDLE_SIZE
    ) {
      return h.handle;
    }
  }
  return null;
}

// ─── Binding support ─────────────────────────────────────

const BINDING_THRESHOLD = 20;

/**
 * Shape types that can be arrow binding targets.
 */
const BINDABLE_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'triangle', 'portal', 'image']);

/**
 * Find the nearest shape within threshold that an arrow endpoint can bind to.
 * Returns the element and the distance from the point to the element's nearest edge.
 *
 * @param canvasX - X coordinate in canvas space
 * @param canvasY - Y coordinate in canvas space
 * @param elements - All visible elements
 * @param excludeIds - Element IDs to exclude (e.g., the arrow being drawn)
 * @param threshold - Max distance from shape edge to snap (default 20)
 */
export function findBindingTarget(
  canvasX: number,
  canvasY: number,
  elements: MavisElement[],
  excludeIds: Set<string> = new Set(),
  threshold: number = BINDING_THRESHOLD,
): { element: MavisElement; gap: number } | null {
  const point: Point = { x: canvasX, y: canvasY };
  let best: { element: MavisElement; gap: number } | null = null;
  let bestDist = threshold;

  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || excludeIds.has(el.id) || !BINDABLE_TYPES.has(el.type)) {
      continue;
    }

    const dist = distanceToElementEdge(point, el);
    if (dist <= bestDist) {
      bestDist = dist;
      best = { element: el, gap: dist };
    }
  }

  return best;
}

/**
 * Compute the approximate distance from a point to the nearest edge of an element.
 */
function distanceToElementEdge(point: Point, element: MavisElement): number {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;

  // Transform to local coordinates if rotated
  let lx = point.x;
  let ly = point.y;
  if (element.angle !== 0) {
    const cos = Math.cos(-element.angle);
    const sin = Math.sin(-element.angle);
    const dx = point.x - cx;
    const dy = point.y - cy;
    lx = cx + dx * cos - dy * sin;
    ly = cy + dx * sin + dy * cos;
  }

  switch (element.type) {
    case 'ellipse': {
      const rx = element.width / 2;
      const ry = element.height / 2;
      if (rx === 0 || ry === 0) return Infinity;
      const dx = lx - cx;
      const dy = ly - cy;
      // Normalize to unit circle
      const norm = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
      if (norm === 0) return Math.min(rx, ry);
      // Approximate distance along radial direction: |dist - dist/norm|
      const distToCenter = Math.sqrt(dx * dx + dy * dy);
      return Math.abs(distToCenter - distToCenter / norm);
    }

    case 'diamond': {
      const hw = element.width / 2;
      const hh = element.height / 2;
      const dx = Math.abs(lx - cx);
      const dy = Math.abs(ly - cy);
      if (hw === 0 || hh === 0) return Infinity;
      // Diamond edge distance
      const edgeVal = dx / hw + dy / hh;
      if (edgeVal === 0) return Math.min(hw, hh);
      // Project to edge
      const scale = 1 / edgeVal;
      const edgeX = dx * scale;
      const edgeY = dy * scale;
      return Math.sqrt((dx - edgeX) ** 2 + (dy - edgeY) ** 2);
    }

    default: {
      // Rectangle-like shapes: distance to nearest edge
      const left = element.x;
      const right = element.x + element.width;
      const top = element.y;
      const bottom = element.y + element.height;

      // Clamp point to rectangle
      const clampedX = Math.max(left, Math.min(right, lx));
      const clampedY = Math.max(top, Math.min(bottom, ly));

      if (lx >= left && lx <= right && ly >= top && ly <= bottom) {
        // Point is inside - distance to nearest edge
        return Math.min(
          lx - left,
          right - lx,
          ly - top,
          bottom - ly,
        );
      }

      return Math.sqrt((lx - clampedX) ** 2 + (ly - clampedY) ** 2);
    }
  }
}

/**
 * Get the point on the element's edge closest to a given direction from center.
 * Used to compute the arrow endpoint when bound to a shape.
 */
export function getBindingPoint(
  element: MavisElement,
  fromX: number,
  fromY: number,
  gap: number = 0,
): Point {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const dx = fromX - cx;
  const dy = fromY - cy;
  const angle = Math.atan2(dy, dx);

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
      // Diamond parametric: |x|/hw + |y|/hh = 1
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
      // Rectangle: find intersection of ray from center with rectangle edges
      const hw = element.width / 2 + gap;
      const hh = element.height / 2 + gap;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      // Avoid division by zero
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

/**
 * Hit test elements considering group membership.
 * If an element belongs to a group, return the outermost group's first element
 * so that clicking any member selects the whole group.
 *
 * @param canvasPoint - Point in canvas coordinates
 * @param elements - All visible elements
 * @param enteredGroupIds - Set of group IDs that have been "entered" (double-clicked)
 */
export function hitTestElementsWithGroups(
  canvasPoint: Point,
  elements: MavisElement[],
  enteredGroupIds: Set<string> = new Set(),
): MavisElement | null {
  const map = new Map<string, MavisElement>();
  for (const el of elements) map.set(el.id, el);

  for (let i = elements.length - 1; i >= 0; i--) {
    if (hitTestElement(canvasPoint, elements[i], map)) {
      const el = elements[i];

      // If element has group IDs, find the outermost group that hasn't been entered
      if (el.groupIds.length > 0) {
        for (const gid of el.groupIds) {
          if (!enteredGroupIds.has(gid)) {
            // Return first element of this group (for selection purposes, the hit element itself)
            return el;
          }
        }
      }

      return el;
    }
  }
  return null;
}

/**
 * Get all element IDs that share a group with the given element,
 * considering the outermost non-entered group.
 */
export function getGroupElementIds(
  element: MavisElement,
  elements: MavisElement[],
  enteredGroupIds: Set<string> = new Set(),
): string[] {
  if (element.groupIds.length === 0) {
    return [element.id];
  }

  // Find the outermost group that hasn't been entered
  let targetGroupId: string | null = null;
  for (const gid of element.groupIds) {
    if (!enteredGroupIds.has(gid)) {
      targetGroupId = gid;
      break;
    }
  }

  if (!targetGroupId) {
    return [element.id];
  }

  // Find all elements that belong to this group
  const ids: string[] = [];
  for (const el of elements) {
    if (!el.isDeleted && el.groupIds.includes(targetGroupId)) {
      ids.push(el.id);
    }
  }

  return ids;
}

// ─── Anchor Points (Phase 3) ─────────────────────────────

export type AnchorPosition = 'top' | 'right' | 'bottom' | 'left';

/**
 * Compute the 4 anchor points (edge midpoints) of an element.
 */
export function getAnchorPoints(element: MavisElement): { position: AnchorPosition; x: number; y: number }[] {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;

  return [
    { position: 'top', x: cx, y: element.y },
    { position: 'right', x: element.x + element.width, y: cy },
    { position: 'bottom', x: cx, y: element.y + element.height },
    { position: 'left', x: element.x, y: cy },
  ];
}

/**
 * Hit test whether a canvas point is near an anchor point of an element.
 * Returns the anchor position if hit, null otherwise.
 */
export function hitTestAnchorPoint(
  canvasPoint: Point,
  element: MavisElement,
  threshold: number = 10,
): AnchorPosition | null {
  const anchors = getAnchorPoints(element);
  for (const anchor of anchors) {
    const dist = Math.hypot(canvasPoint.x - anchor.x, canvasPoint.y - anchor.y);
    if (dist <= threshold) {
      return anchor.position;
    }
  }
  return null;
}

/**
 * Find if cursor is near any shape edge (within proximity) for showing anchor indicators.
 * Returns the element if within proximity of its edge, null otherwise.
 */
export function findNearbyShapeForAnchors(
  canvasX: number,
  canvasY: number,
  elements: MavisElement[],
  excludeIds: Set<string> = new Set(),
  proximity: number = 30,
): MavisElement | null {
  const point: Point = { x: canvasX, y: canvasY };
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || excludeIds.has(el.id) || !BINDABLE_TYPES.has(el.type)) continue;

    const dist = distanceToElementEdge(point, el);
    if (dist <= proximity) {
      return el;
    }
  }
  return null;
}

// ─── Endpoint Handles (Phase 4) ─────────────────────────────

/**
 * Get the canvas-space positions of a linear element's start and end points.
 */
export function getLinearEndpoints(element: LinearElement): { start: Point; end: Point } {
  const startPt = element.points[0];
  const endPt = element.points[element.points.length - 1];
  return {
    start: { x: element.x + startPt[0], y: element.y + startPt[1] },
    end: { x: element.x + endPt[0], y: element.y + endPt[1] },
  };
}

/**
 * Hit test whether a canvas point hits the start or end handle of a linear element.
 * Returns 'start', 'end', or null.
 */
export function hitTestEndpointHandle(
  canvasPoint: Point,
  element: LinearElement,
  handleRadius: number = 8,
): 'start' | 'end' | null {
  const { start, end } = getLinearEndpoints(element);
  if (Math.hypot(canvasPoint.x - end.x, canvasPoint.y - end.y) <= handleRadius) {
    return 'end';
  }
  if (Math.hypot(canvasPoint.x - start.x, canvasPoint.y - start.y) <= handleRadius) {
    return 'start';
  }
  return null;
}

// ─── Waypoint Handles (Phase 5) ─────────────────────────────

/**
 * Get the midpoints of each segment in a linear element (for showing + handles).
 */
export function getSegmentMidpoints(element: LinearElement): Point[] {
  const midpoints: Point[] = [];
  for (let i = 0; i < element.points.length - 1; i++) {
    const [x1, y1] = element.points[i];
    const [x2, y2] = element.points[i + 1];
    midpoints.push({
      x: element.x + (x1 + x2) / 2,
      y: element.y + (y1 + y2) / 2,
    });
  }
  return midpoints;
}

/**
 * Hit test whether a canvas point hits a segment midpoint (+ handle).
 * Returns the segment index if hit, -1 otherwise.
 */
export function hitTestMidpointHandle(
  canvasPoint: Point,
  element: LinearElement,
  handleRadius: number = 8,
): number {
  const midpoints = getSegmentMidpoints(element);
  for (let i = 0; i < midpoints.length; i++) {
    const dist = Math.hypot(canvasPoint.x - midpoints[i].x, canvasPoint.y - midpoints[i].y);
    if (dist <= handleRadius) {
      return i;
    }
  }
  return -1;
}

/**
 * Hit test whether a canvas point hits a waypoint (intermediate point, not start/end).
 * Returns the point index if hit, -1 otherwise.
 */
export function hitTestWaypoint(
  canvasPoint: Point,
  element: LinearElement,
  handleRadius: number = 8,
): number {
  for (let i = 1; i < element.points.length - 1; i++) {
    const px = element.x + element.points[i][0];
    const py = element.y + element.points[i][1];
    if (Math.hypot(canvasPoint.x - px, canvasPoint.y - py) <= handleRadius) {
      return i;
    }
  }
  return -1;
}

import type { MavisElement, Point, Bounds, LinearElement } from '@mavisdraw/types';

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
function hitTestPolyline(canvasPoint: Point, element: MavisElement): boolean {
  const linear = element as LinearElement;
  if (!linear.points || linear.points.length < 2) return false;

  const tolerance = HIT_TOLERANCE + element.strokeWidth / 2;

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
export function hitTestElement(canvasPoint: Point, element: MavisElement): boolean {
  if (element.isDeleted) return false;

  // For linear elements, use polyline testing directly in canvas space
  if (element.type === 'line' || element.type === 'arrow' || element.type === 'freedraw') {
    return hitTestPolyline(canvasPoint, element);
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
  // Iterate in reverse to find topmost element first
  for (let i = elements.length - 1; i >= 0; i--) {
    if (hitTestElement(canvasPoint, elements[i])) {
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

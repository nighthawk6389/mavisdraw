import type { Bounds, Point } from '@mavisdraw/types';

/**
 * Pure geometry behind pointer gestures: how a box grows while it's drawn or
 * resized (with Shift / Alt), axis locking while moving, angle steps and the
 * drag threshold. No DOM, no stores — the InteractionManager feeds it pointer
 * positions and applies the results.
 */

export type BoxHandle =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/** Movement (screen px) before a press becomes a drag: Figma/tldraw use 3–4px for a mouse. */
export const DRAG_THRESHOLD_PX = 4;
/** Fingers and pens wobble more (tldraw uses 6px for coarse pointers). */
export const COARSE_DRAG_THRESHOLD_PX = 6;

/** True once a press has moved far enough (in screen pixels) to count as a drag. */
export function exceedsDragThreshold(
  start: Point,
  current: Point,
  pointerType: string = 'mouse',
): boolean {
  const limit = pointerType === 'mouse' ? DRAG_THRESHOLD_PX : COARSE_DRAG_THRESHOLD_PX;
  return Math.hypot(current.x - start.x, current.y - start.y) > limit;
}

/** Shift-drag: keep only the dominant axis of a move (Excalidraw, tldraw, Figma). */
export function lockToAxis(delta: Point): Point {
  return Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y };
}

/** Which axis a Shift-locked move keeps ('x' or 'y'). */
export function dominantAxis(delta: Point): 'x' | 'y' {
  return Math.abs(delta.x) >= Math.abs(delta.y) ? 'x' : 'y';
}

/** 15° — the step Shift snaps lines and rotations to everywhere (Excalidraw, tldraw, Figma). */
export const ANGLE_STEP = Math.PI / 12;

/** Snap an angle (radians) to the nearest multiple of `step`. */
export function snapAngle(angle: number, step = ANGLE_STEP): number {
  return Math.round(angle / step) * step;
}

/** Shift while drawing a line/arrow: keep its length, snap its direction to 15° steps. */
export function snapVectorAngle(vector: Point, step = ANGLE_STEP): Point {
  const length = Math.hypot(vector.x, vector.y);
  if (length === 0) return { x: 0, y: 0 };
  const angle = snapAngle(Math.atan2(vector.y, vector.x), step);
  const x = Math.cos(angle) * length;
  const y = Math.sin(angle) * length;
  // Kill floating-point dust so horizontal/vertical lines are exactly straight
  return { x: Math.abs(x) < 1e-9 ? 0 : x, y: Math.abs(y) < 1e-9 ? 0 : y };
}

export interface BoxModifiers {
  /** Shift: square / circle while drawing; keep proportions while resizing. */
  keepAspect: boolean;
  /** Alt: grow symmetrically around the press point / the box centre. */
  fromCenter: boolean;
}

/**
 * Box spanned while drawing a new shape from `origin` (where the press
 * started) to `pointer`. Shift makes it square, Alt grows it from the centre.
 */
export function creationBox(origin: Point, pointer: Point, mods: BoxModifiers): Bounds {
  let dx = pointer.x - origin.x;
  let dy = pointer.y - origin.y;
  if (mods.keepAspect) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side;
    dy = (dy < 0 ? -1 : 1) * side;
  }
  if (mods.fromCenter) {
    return {
      x: origin.x - Math.abs(dx),
      y: origin.y - Math.abs(dy),
      width: Math.abs(dx) * 2,
      height: Math.abs(dy) * 2,
    };
  }
  return {
    x: Math.min(origin.x, origin.x + dx),
    y: Math.min(origin.y, origin.y + dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  };
}

/** Size a shape gets when the tool is clicked instead of dragged (tldraw, Miro). */
export function defaultShapeSize(type: string): { width: number; height: number } {
  switch (type) {
    case 'ellipse':
      return { width: 140, height: 90 };
    case 'diamond':
      return { width: 140, height: 100 };
    case 'portal':
      return { width: 200, height: 140 };
    default:
      // A service / component box: wider than tall, room for a two-word label
      return { width: 160, height: 80 };
  }
}

/** A box of the default size centred on `at`. */
export function placedBox(type: string, at: Point): Bounds {
  const { width, height } = defaultShapeSize(type);
  return { x: at.x - width / 2, y: at.y - height / 2, width, height };
}

/**
 * The result of a resize as an affine map per axis: a coordinate `v` of
 * anything inside the original selection moves to `origin + (v - origin) *
 * scale`. Negative scales mean the box was dragged past its opposite edge
 * (flipped), as in Excalidraw and tldraw.
 */
export interface ResizeResult {
  /** The new, normalised selection box (width/height ≥ 0). */
  box: Bounds;
  scaleX: number;
  scaleY: number;
  /** Fixed point of the scaling, per axis. */
  originX: number;
  originY: number;
}

export interface ResizeOptions extends BoxModifiers {
  /** Smallest |width| / |height| the box may shrink to (canvas units). */
  minSize?: number;
  /** Disallow flipping (e.g. images, which can't be drawn mirrored). */
  noFlip?: boolean;
}

/** Direction a handle moves its box along each axis: -1 (left/top), 0 (not at all), 1 (right/bottom). */
export function handleSides(handle: BoxHandle): { h: -1 | 0 | 1; v: -1 | 0 | 1 } {
  const h = handle.endsWith('left') ? -1 : handle.endsWith('right') ? 1 : 0;
  const v = handle.startsWith('top') ? -1 : handle.startsWith('bottom') ? 1 : 0;
  return { h, v };
}

/**
 * Resize `start` by dragging `handle` by `delta` (canvas units).
 *
 * - Edge handles change one axis; corners change both.
 * - Shift (keepAspect) keeps proportions; on an edge handle the other axis
 *   grows symmetrically around the edge's midpoint (tldraw).
 * - Alt (fromCenter) mirrors the change on the opposite side.
 * - Dragging past the opposite edge flips instead of getting stuck.
 */
export function resizeBox(
  start: Bounds,
  handle: BoxHandle,
  delta: Point,
  options: ResizeOptions,
): ResizeResult {
  const { h, v } = handleSides(handle);
  const minSize = options.minSize ?? 1;
  const cx = start.x + start.width / 2;
  const cy = start.y + start.height / 2;

  // Fixed point per axis: the opposite edge, or the centre with Alt
  const originX = options.fromCenter || h === 0 ? cx : h > 0 ? start.x : start.x + start.width;
  const originY = options.fromCenter || v === 0 ? cy : v > 0 ? start.y : start.y + start.height;

  // Where the dragged handle started, relative to the fixed point
  const handleX = h > 0 ? start.x + start.width : start.x;
  const handleY = v > 0 ? start.y + start.height : start.y;
  const spanX = handleX - originX;
  const spanY = handleY - originY;

  let scaleX = h !== 0 && spanX !== 0 ? (spanX + delta.x) / spanX : 1;
  let scaleY = v !== 0 && spanY !== 0 ? (spanY + delta.y) / spanY : 1;

  if (options.keepAspect) {
    if (h === 0) {
      scaleX = Math.abs(scaleY);
    } else if (v === 0) {
      scaleY = Math.abs(scaleX);
    } else if (Math.abs(scaleX) > Math.abs(scaleY)) {
      scaleY = Math.abs(scaleX) * (scaleY < 0 ? -1 : 1);
    } else {
      scaleX = Math.abs(scaleY) * (scaleX < 0 ? -1 : 1);
    }
  }

  const clampScale = (scale: number, size: number): number => {
    if (size <= 0) return scale;
    const min = minSize / size;
    if (options.noFlip && scale < min) return min;
    if (Math.abs(scale) < min) return scale < 0 ? -min : min;
    return scale;
  };
  scaleX = clampScale(scaleX, start.width);
  scaleY = clampScale(scaleY, start.height);

  const map = (value: number, origin: number, scale: number) => origin + (value - origin) * scale;
  const x1 = map(start.x, originX, scaleX);
  const x2 = map(start.x + start.width, originX, scaleX);
  const y1 = map(start.y, originY, scaleY);
  const y2 = map(start.y + start.height, originY, scaleY);

  return {
    box: {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    },
    scaleX,
    scaleY,
    originX,
    originY,
  };
}

/**
 * Coordinates a resize gesture can snap along one axis, before aspect locking:
 * the dragged edge (k = 1) and, with Alt, its mirror image on the other side
 * (k = -1, it moves the opposite way). Snapping value `i` by `offset` means
 * adding `offset * k[i]` to the pointer delta on that axis.
 */
export function resizeSnapCandidates(
  start: Bounds,
  handle: BoxHandle,
  delta: Point,
  fromCenter: boolean,
): { x: { values: number[]; k: number[] }; y: { values: number[]; k: number[] } } {
  const { h, v } = handleSides(handle);
  const axis = (dir: number, lo: number, size: number, d: number) => {
    if (dir === 0) return { values: [] as number[], k: [] as number[] };
    const edge = (dir > 0 ? lo + size : lo) + d;
    if (!fromCenter) return { values: [edge], k: [1] };
    const centre = lo + size / 2;
    return { values: [edge, 2 * centre - edge], k: [1, -1] };
  };
  return {
    x: axis(h, start.x, start.width, delta.x),
    y: axis(v, start.y, start.height, delta.y),
  };
}

/**
 * Apply a resize to one element's box. Returns the element's new box and, for
 * elements made of points (lines, arrows, freedraw), their transformed points
 * relative to the new origin (mirrored when the selection flipped).
 */
export function scaleElementBox(
  element: { x: number; y: number; width: number; height: number },
  result: ResizeResult,
  points?: [number, number][],
): { x: number; y: number; width: number; height: number; points?: [number, number][] } {
  const mapX = (value: number) => result.originX + (value - result.originX) * result.scaleX;
  const mapY = (value: number) => result.originY + (value - result.originY) * result.scaleY;
  if (points) {
    // Keep the element's origin where its old origin maps to; points are relative
    const x = mapX(element.x);
    const y = mapY(element.y);
    return {
      x,
      y,
      width: Math.abs(element.width * result.scaleX),
      height: Math.abs(element.height * result.scaleY),
      points: points.map(([px, py]) => [px * result.scaleX, py * result.scaleY]),
    };
  }
  const x1 = mapX(element.x);
  const x2 = mapX(element.x + element.width);
  const y1 = mapY(element.y);
  const y2 = mapY(element.y + element.height);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.max(1, Math.abs(x2 - x1)),
    height: Math.max(1, Math.abs(y2 - y1)),
  };
}

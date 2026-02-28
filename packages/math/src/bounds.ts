import type { Point, Bounds } from '@mavisdraw/types';

/**
 * An element with position, size, and optional rotation used for
 * computing aggregate bounding boxes.
 */
export interface BoundsElement {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
}

/**
 * Compute the axis-aligned bounding box that encloses all given elements.
 * Takes rotation into account by computing rotated corner positions.
 * Returns a zero-area bounds at origin if the array is empty.
 */
export function getBounds(elements: BoundsElement[]): Bounds {
  if (elements.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    const corners = getElementCorners(el);
    for (const corner of corners) {
      if (corner.x < minX) minX = corner.x;
      if (corner.y < minY) minY = corner.y;
      if (corner.x > maxX) maxX = corner.x;
      if (corner.y > maxY) maxY = corner.y;
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Get the four corner points of an element, taking rotation into account.
 */
function getElementCorners(el: BoundsElement): Point[] {
  const { x, y, width, height, angle = 0 } = el;

  // Unrotated corners
  const corners: Point[] = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];

  if (angle === 0) {
    return corners;
  }

  // Rotate around the center of the element
  const cx = x + width / 2;
  const cy = y + height / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return corners.map((corner) => {
    const dx = corner.x - cx;
    const dy = corner.y - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  });
}

/**
 * Check if an axis-aligned bounding box contains a given point.
 */
export function containsPoint(bounds: Bounds, point: Point): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

/**
 * Check if two axis-aligned bounding boxes intersect (overlap).
 */
export function intersects(a: Bounds, b: Bounds): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Expand (or shrink if negative) a bounding box by a given padding on all sides.
 */
export function expandBy(bounds: Bounds, padding: number): Bounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

/**
 * Get the center point of a bounding box.
 */
export function getCenter(bounds: Bounds): Point {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

/**
 * Get the four corner points of an axis-aligned bounding box.
 * Returns [topLeft, topRight, bottomRight, bottomLeft].
 */
export function getCorners(bounds: Bounds): [Point, Point, Point, Point] {
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
}

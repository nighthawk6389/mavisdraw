import type { Point, Bounds } from '@mavisdraw/types';

/**
 * Compute the intersection point of two line segments (p1-p2 and p3-p4).
 * Returns the intersection point, or null if the segments do not intersect.
 */
export function lineLineIntersection(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
): Point | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;

  const denom = d1x * d2y - d1y * d2x;

  // Lines are parallel (or coincident)
  if (Math.abs(denom) < 1e-10) {
    return null;
  }

  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;

  // Check that the intersection lies within both segments
  if (t < 0 || t > 1 || u < 0 || u > 1) {
    return null;
  }

  return {
    x: p1.x + t * d1x,
    y: p1.y + t * d1y,
  };
}

/**
 * Compute all intersection points of a line segment (p1-p2) with an
 * axis-aligned rectangle.
 * Returns an array of intersection points (0 to 2 points).
 */
export function lineRectIntersection(
  p1: Point,
  p2: Point,
  rect: Bounds,
): Point[] {
  const { x, y, width, height } = rect;

  // Four edges of the rectangle
  const topLeft: Point = { x, y };
  const topRight: Point = { x: x + width, y };
  const bottomRight: Point = { x: x + width, y: y + height };
  const bottomLeft: Point = { x, y: y + height };

  const edges: [Point, Point][] = [
    [topLeft, topRight], // top
    [topRight, bottomRight], // right
    [bottomRight, bottomLeft], // bottom
    [bottomLeft, topLeft], // left
  ];

  const intersections: Point[] = [];

  for (const [edgeStart, edgeEnd] of edges) {
    const hit = lineLineIntersection(p1, p2, edgeStart, edgeEnd);
    if (hit !== null) {
      // Avoid duplicate points at corners
      const isDuplicate = intersections.some(
        (existing) =>
          Math.abs(existing.x - hit.x) < 1e-10 &&
          Math.abs(existing.y - hit.y) < 1e-10,
      );
      if (!isDuplicate) {
        intersections.push(hit);
      }
    }
  }

  return intersections;
}

/**
 * Check if a point is inside an axis-aligned or rotated rectangle.
 * The rect is defined by its bounding box (x, y, width, height) and
 * an optional rotation angle around its center.
 */
export function pointInRect(
  point: Point,
  rect: Bounds & { angle?: number },
): boolean {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const angle = rect.angle ?? 0;

  // Rotate the point into the rectangle's local coordinate system
  let localX = point.x - cx;
  let localY = point.y - cy;

  if (angle !== 0) {
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const rx = localX * cos - localY * sin;
    const ry = localX * sin + localY * cos;
    localX = rx;
    localY = ry;
  }

  const halfW = rect.width / 2;
  const halfH = rect.height / 2;

  return (
    localX >= -halfW &&
    localX <= halfW &&
    localY >= -halfH &&
    localY <= halfH
  );
}

/**
 * Check if a point is inside an ellipse, potentially rotated by angle.
 *
 * @param point - The point to test
 * @param center - Center of the ellipse
 * @param radiusX - Horizontal radius
 * @param radiusY - Vertical radius
 * @param angle - Rotation angle in radians (default 0)
 */
export function pointInEllipse(
  point: Point,
  center: Point,
  radiusX: number,
  radiusY: number,
  angle: number = 0,
): boolean {
  // Transform point into ellipse-local coordinates
  let dx = point.x - center.x;
  let dy = point.y - center.y;

  if (angle !== 0) {
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    dx = rx;
    dy = ry;
  }

  // Standard ellipse equation: (x/a)^2 + (y/b)^2 <= 1
  if (radiusX === 0 || radiusY === 0) {
    return false;
  }

  return (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1;
}

/**
 * Check if a point is inside a diamond (rhombus) shape.
 * The diamond is defined by its center, width, height, and optional rotation.
 * The diamond vertices are at the midpoints of the bounding rectangle edges.
 *
 * @param point - The point to test
 * @param center - Center of the diamond
 * @param width - Full width of the diamond
 * @param height - Full height of the diamond
 * @param angle - Rotation angle in radians (default 0)
 */
export function pointInDiamond(
  point: Point,
  center: Point,
  width: number,
  height: number,
  angle: number = 0,
): boolean {
  // Transform point into diamond-local coordinates
  let dx = point.x - center.x;
  let dy = point.y - center.y;

  if (angle !== 0) {
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    dx = rx;
    dy = ry;
  }

  const halfW = width / 2;
  const halfH = height / 2;

  if (halfW === 0 || halfH === 0) {
    return false;
  }

  // Diamond inequality: |x|/halfW + |y|/halfH <= 1
  return Math.abs(dx) / halfW + Math.abs(dy) / halfH <= 1;
}

/**
 * Check if two axis-aligned rectangles overlap.
 */
export function rectOverlapsRect(a: Bounds, b: Bounds): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

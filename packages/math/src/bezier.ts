import type { Point } from '@mavisdraw/types';

/**
 * Compute a point on a quadratic Bezier curve at parameter t.
 *
 * @param p0 - Start point
 * @param p1 - Control point
 * @param p2 - End point
 * @param t - Parameter in [0, 1]
 */
export function quadraticPoint(
  p0: Point,
  p1: Point,
  p2: Point,
  t: number,
): Point {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;

  return {
    x: mt2 * p0.x + 2 * mt * t * p1.x + t2 * p2.x,
    y: mt2 * p0.y + 2 * mt * t * p1.y + t2 * p2.y,
  };
}

/**
 * Compute a point on a cubic Bezier curve at parameter t.
 *
 * @param p0 - Start point
 * @param p1 - First control point
 * @param p2 - Second control point
 * @param p3 - End point
 * @param t - Parameter in [0, 1]
 */
export function cubicPoint(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): Point {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
  };
}

/**
 * Approximate the arc length of a quadratic Bezier curve by sampling.
 *
 * @param p0 - Start point
 * @param p1 - Control point
 * @param p2 - End point
 * @param steps - Number of linear segments to approximate with (default 64)
 */
export function quadraticLength(
  p0: Point,
  p1: Point,
  p2: Point,
  steps: number = 64,
): number {
  let length = 0;
  let prev = p0;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const current = quadraticPoint(p0, p1, p2, t);
    const dx = current.x - prev.x;
    const dy = current.y - prev.y;
    length += Math.sqrt(dx * dx + dy * dy);
    prev = current;
  }

  return length;
}

/**
 * Approximate the arc length of a cubic Bezier curve by sampling.
 *
 * @param p0 - Start point
 * @param p1 - First control point
 * @param p2 - Second control point
 * @param p3 - End point
 * @param steps - Number of linear segments to approximate with (default 64)
 */
export function cubicLength(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  steps: number = 64,
): number {
  let length = 0;
  let prev = p0;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const current = cubicPoint(p0, p1, p2, p3, t);
    const dx = current.x - prev.x;
    const dy = current.y - prev.y;
    length += Math.sqrt(dx * dx + dy * dy);
    prev = current;
  }

  return length;
}

/**
 * A cubic Bezier segment defined by four control points.
 */
export interface CubicSegment {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

/**
 * Split a cubic Bezier curve at parameter t using de Casteljau's algorithm.
 * Returns two cubic Bezier segments [left, right] that together form the
 * original curve.
 *
 * @param p0 - Start point
 * @param p1 - First control point
 * @param p2 - Second control point
 * @param p3 - End point
 * @param t - Split parameter in [0, 1]
 */
export function splitCubic(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): [CubicSegment, CubicSegment] {
  // First level interpolation
  const p01 = lerpPoint(p0, p1, t);
  const p12 = lerpPoint(p1, p2, t);
  const p23 = lerpPoint(p2, p3, t);

  // Second level interpolation
  const p012 = lerpPoint(p01, p12, t);
  const p123 = lerpPoint(p12, p23, t);

  // Third level interpolation - the split point
  const p0123 = lerpPoint(p012, p123, t);

  const left: CubicSegment = {
    p0: p0,
    p1: p01,
    p2: p012,
    p3: p0123,
  };

  const right: CubicSegment = {
    p0: p0123,
    p1: p123,
    p2: p23,
    p3: p3,
  };

  return [left, right];
}

/**
 * Evaluate a Bezier curve at parameter t.
 * Accepts 2 points (linear), 3 (quadratic), or 4 (cubic).
 *
 * @param points - Control points (2, 3, or 4 points)
 * @param t - Parameter in [0, 1]
 */
export function evaluateBezier(points: Point[], t: number): Point {
  if (points.length === 2) {
    return lerpPoint(points[0], points[1], t);
  }
  if (points.length === 3) {
    return quadraticPoint(points[0], points[1], points[2], t);
  }
  if (points.length === 4) {
    return cubicPoint(points[0], points[1], points[2], points[3], t);
  }
  throw new Error(`evaluateBezier expects 2-4 points, got ${points.length}`);
}

/**
 * Split a Bezier curve at parameter t.
 * Works with cubic curves (4 control points).
 * Returns the two resulting segments as arrays of 4 points each.
 *
 * @param points - Four control points [p0, p1, p2, p3]
 * @param t - Split parameter in [0, 1]
 */
export function splitBezier(
  points: [Point, Point, Point, Point],
  t: number,
): [Point[], Point[]] {
  const [left, right] = splitCubic(points[0], points[1], points[2], points[3], t);
  return [
    [left.p0, left.p1, left.p2, left.p3],
    [right.p0, right.p1, right.p2, right.p3],
  ];
}

/**
 * Project a point onto a cubic Bezier curve.
 * Returns the closest parameter t and the closest point on the curve.
 *
 * Uses iterative sampling then refinement for accuracy.
 *
 * @param point - The point to project
 * @param bezierPoints - Four control points [p0, p1, p2, p3]
 * @param samples - Number of initial samples (default 64)
 */
export function projectPointOnBezier(
  point: Point,
  bezierPoints: [Point, Point, Point, Point],
  samples: number = 64,
): { t: number; point: Point; distance: number } {
  const [p0, p1, p2, p3] = bezierPoints;

  // Initial coarse sampling
  let bestT = 0;
  let bestDist = Infinity;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = cubicPoint(p0, p1, p2, p3, t);
    const dx = p.x - point.x;
    const dy = p.y - point.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestT = t;
    }
  }

  // Refinement via binary subdivision
  let lo = Math.max(0, bestT - 1 / samples);
  let hi = Math.min(1, bestT + 1 / samples);

  for (let iter = 0; iter < 16; iter++) {
    const mid = (lo + hi) / 2;
    const tLo = (lo + mid) / 2;
    const tHi = (mid + hi) / 2;

    const pLo = cubicPoint(p0, p1, p2, p3, tLo);
    const pHi = cubicPoint(p0, p1, p2, p3, tHi);

    const dLo = (pLo.x - point.x) ** 2 + (pLo.y - point.y) ** 2;
    const dHi = (pHi.x - point.x) ** 2 + (pHi.y - point.y) ** 2;

    if (dLo < dHi) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  bestT = (lo + hi) / 2;
  const bestPoint = cubicPoint(p0, p1, p2, p3, bestT);
  const dx = bestPoint.x - point.x;
  const dy = bestPoint.y - point.y;

  return {
    t: bestT,
    point: bestPoint,
    distance: Math.sqrt(dx * dx + dy * dy),
  };
}

/**
 * Compute the axis-aligned bounding box of a cubic Bezier curve.
 * Uses sampling for a fast approximation.
 *
 * @param points - Four control points [p0, p1, p2, p3]
 * @param samples - Number of samples (default 64)
 */
export function getBezierBounds(
  points: [Point, Point, Point, Point],
  samples: number = 64,
): { x: number; y: number; width: number; height: number } {
  const [p0, p1, p2, p3] = points;
  let minX = Math.min(p0.x, p3.x);
  let minY = Math.min(p0.y, p3.y);
  let maxX = Math.max(p0.x, p3.x);
  let maxY = Math.max(p0.y, p3.y);

  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const p = cubicPoint(p0, p1, p2, p3, t);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Generate cubic Bezier control points for a smooth curve between start and end.
 * Produces a natural-looking S-curve or C-curve.
 *
 * @param start - Start point
 * @param end - End point
 * @param curvature - How much the curve bends (0 = straight, 1 = full curve). Default 0.5.
 */
export function getCubicControlPoints(
  start: Point,
  end: Point,
  curvature: number = 0.5,
): [Point, Point, Point, Point] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // Generate control points by offsetting along the perpendicular
  // and along the direction of the line
  const offsetX = Math.abs(dx) * curvature;
  const offsetY = Math.abs(dy) * curvature;

  // Determine the dominant direction
  let cp1: Point;
  let cp2: Point;

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Horizontal-ish: curve control points extend horizontally
    cp1 = { x: start.x + offsetX, y: start.y };
    cp2 = { x: end.x - offsetX, y: end.y };
  } else {
    // Vertical-ish: curve control points extend vertically
    cp1 = { x: start.x, y: start.y + (dy > 0 ? offsetY : -offsetY) };
    cp2 = { x: end.x, y: end.y - (dy > 0 ? offsetY : -offsetY) };
  }

  return [start, cp1, cp2, end];
}

/**
 * Linear interpolation between two points.
 */
function lerpPoint(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

import type { Point } from '@mavisdraw/types';

/**
 * Compute the Euclidean distance between two points.
 */
export function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute the midpoint between two points.
 */
export function midpoint(a: Point, b: Point): Point {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

/**
 * Add two points (component-wise addition).
 */
export function add(a: Point, b: Point): Point {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
  };
}

/**
 * Subtract point b from point a (component-wise subtraction).
 */
export function subtract(a: Point, b: Point): Point {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
  };
}

/**
 * Scale a point by a scalar factor.
 */
export function scale(p: Point, factor: number): Point {
  return {
    x: p.x * factor,
    y: p.y * factor,
  };
}

/**
 * Rotate a point around a center point by a given angle in radians.
 */
export function rotate(p: Point, center: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/**
 * Linear interpolation between two points.
 * At t=0 returns a, at t=1 returns b.
 */
export function lerp(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/**
 * Perpendicular distance from a point to the line defined by lineStart and lineEnd.
 */
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return distance(point, lineStart);
  }

  const num = Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x);
  return num / Math.sqrt(lenSq);
}

/**
 * Simplify a polyline using the Ramer-Douglas-Peucker algorithm.
 * Reduces the number of points while preserving the overall shape.
 *
 * @param points - Array of points forming a polyline
 * @param tolerance - Maximum distance a point can deviate from the simplified line.
 *                    Higher values produce fewer points.
 * @returns Simplified array of points
 */
export function simplifyPoints(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) {
    return points.slice();
  }

  return rdpSimplify(points, 0, points.length - 1, tolerance);
}

/**
 * Recursive Ramer-Douglas-Peucker implementation.
 */
function rdpSimplify(points: Point[], startIdx: number, endIdx: number, tolerance: number): Point[] {
  if (endIdx - startIdx < 2) {
    return [points[startIdx], points[endIdx]];
  }

  let maxDist = 0;
  let maxIdx = startIdx;

  const lineStart = points[startIdx];
  const lineEnd = points[endIdx];

  for (let i = startIdx + 1; i < endIdx; i++) {
    const dist = perpendicularDistance(points[i], lineStart, lineEnd);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = rdpSimplify(points, startIdx, maxIdx, tolerance);
    const right = rdpSimplify(points, maxIdx, endIdx, tolerance);
    // Remove the duplicate point at the junction
    return [...left.slice(0, -1), ...right];
  }

  return [points[startIdx], points[endIdx]];
}

/**
 * Simplify a polyline from tuple format [x, y][] using Ramer-Douglas-Peucker.
 *
 * @param points - Array of [x, y] tuples
 * @param tolerance - Maximum distance tolerance
 * @returns Simplified [x, y] tuples
 */
export function simplifyTuplePoints(
  points: [number, number][],
  tolerance: number,
): [number, number][] {
  const asPoints: Point[] = points.map(([x, y]) => ({ x, y }));
  const simplified = simplifyPoints(asPoints, tolerance);
  return simplified.map((p) => [p.x, p.y] as [number, number]);
}

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
 * Linear interpolation between two points.
 */
function lerpPoint(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

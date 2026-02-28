import type { Point } from '@mavisdraw/types';

/**
 * Compute the length (magnitude) of a vector.
 */
export function length(v: Point): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/**
 * Normalize a vector to a unit vector (length 1).
 * Returns a zero vector if the input has zero length.
 */
export function normalize(v: Point): Point {
  const len = length(v);
  if (len === 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: v.x / len,
    y: v.y / len,
  };
}

/**
 * Compute the dot product of two vectors.
 */
export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Compute the 2D cross product (scalar value).
 * This is the z-component of the 3D cross product when z=0.
 * Positive means b is counter-clockwise from a.
 */
export function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

/**
 * Compute a perpendicular vector (rotated 90 degrees counter-clockwise).
 */
export function perpendicular(v: Point): Point {
  return { x: -v.y, y: v.x };
}

/**
 * Compute the angle between two vectors in radians.
 * Returns a value in the range [0, PI].
 */
export function angleBetween(a: Point, b: Point): number {
  const lenA = length(a);
  const lenB = length(b);
  if (lenA === 0 || lenB === 0) {
    return 0;
  }
  const cosAngle = dot(a, b) / (lenA * lenB);
  // Clamp to [-1, 1] to avoid NaN from floating-point imprecision
  return Math.acos(Math.max(-1, Math.min(1, cosAngle)));
}

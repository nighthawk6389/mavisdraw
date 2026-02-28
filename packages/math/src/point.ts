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

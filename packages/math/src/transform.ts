import type { Point, Viewport } from '@mavisdraw/types';

/**
 * A 2D affine transform matrix represented as a 6-element tuple:
 * [a, b, c, d, tx, ty]
 *
 * This corresponds to the matrix:
 *   | a  c  tx |
 *   | b  d  ty |
 *   | 0  0  1  |
 *
 * When applied to a point (x, y):
 *   x' = a*x + c*y + tx
 *   y' = b*x + d*y + ty
 */
export type Matrix = [number, number, number, number, number, number];

/**
 * Create an identity matrix.
 */
export function createIdentity(): Matrix {
  return [1, 0, 0, 1, 0, 0];
}

/**
 * Apply a translation to a matrix.
 * Returns a new matrix that is the composition: translate(tx, ty) * m
 */
export function translate(m: Matrix, tx: number, ty: number): Matrix {
  const [a, b, c, d, mtx, mty] = m;
  return [
    a,
    b,
    c,
    d,
    a * tx + c * ty + mtx,
    b * tx + d * ty + mty,
  ];
}

/**
 * Apply a scale to a matrix.
 * Returns a new matrix that is the composition: m * scale(sx, sy)
 */
export function scaleMatrix(m: Matrix, sx: number, sy: number): Matrix {
  const [a, b, c, d, tx, ty] = m;
  return [
    a * sx,
    b * sx,
    c * sy,
    d * sy,
    tx,
    ty,
  ];
}

/**
 * Apply a rotation to a matrix.
 * Returns a new matrix that is the composition: m * rotate(angle)
 *
 * @param m - The current matrix
 * @param angle - Rotation angle in radians
 */
export function rotateMatrix(m: Matrix, angle: number): Matrix {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [a, b, c, d, tx, ty] = m;
  return [
    a * cos + c * sin,
    b * cos + d * sin,
    a * -sin + c * cos,
    b * -sin + d * cos,
    tx,
    ty,
  ];
}

/**
 * Transform a point by a matrix.
 */
export function applyToPoint(m: Matrix, point: Point): Point {
  const [a, b, c, d, tx, ty] = m;
  return {
    x: a * point.x + c * point.y + tx,
    y: b * point.x + d * point.y + ty,
  };
}

/**
 * Compute the inverse of a matrix.
 * Throws if the matrix is singular (non-invertible).
 */
export function inverse(m: Matrix): Matrix {
  const [a, b, c, d, tx, ty] = m;
  const det = a * d - b * c;

  if (Math.abs(det) < 1e-10) {
    throw new Error('Matrix is singular and cannot be inverted');
  }

  const invDet = 1 / det;

  return [
    d * invDet,
    -b * invDet,
    -c * invDet,
    a * invDet,
    (c * ty - d * tx) * invDet,
    (b * tx - a * ty) * invDet,
  ];
}

/**
 * Convert screen coordinates to canvas coordinates given a viewport.
 * The viewport defines the current scroll offset and zoom level.
 *
 * Canvas coordinates = (screen coordinates - scroll offset) / zoom
 *
 * @param screenPoint - The point in screen (pixel) coordinates
 * @param viewport - The current viewport state { scrollX, scrollY, zoom }
 */
export function screenToCanvas(screenPoint: Point, viewport: Viewport): Point {
  return {
    x: (screenPoint.x - viewport.scrollX) / viewport.zoom,
    y: (screenPoint.y - viewport.scrollY) / viewport.zoom,
  };
}

/**
 * Convert canvas coordinates to screen coordinates given a viewport.
 * The viewport defines the current scroll offset and zoom level.
 *
 * Screen coordinates = canvas coordinates * zoom + scroll offset
 *
 * @param canvasPoint - The point in canvas (world) coordinates
 * @param viewport - The current viewport state { scrollX, scrollY, zoom }
 */
export function canvasToScreen(canvasPoint: Point, viewport: Viewport): Point {
  return {
    x: canvasPoint.x * viewport.zoom + viewport.scrollX,
    y: canvasPoint.y * viewport.zoom + viewport.scrollY,
  };
}

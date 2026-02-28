import { describe, it, expect } from 'vitest';
import { getBounds, containsPoint, intersects, expandBy, getCenter, getCorners } from '../bounds';

describe('bounds', () => {
  describe('getBounds', () => {
    it('returns zero bounds for empty array', () => {
      expect(getBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });

    it('returns bounds for a single unrotated element', () => {
      const result = getBounds([{ x: 10, y: 20, width: 30, height: 40 }]);
      expect(result).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    });

    it('computes enclosing bounds for multiple elements', () => {
      const result = getBounds([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 20, width: 10, height: 10 },
      ]);
      expect(result).toEqual({ x: 0, y: 0, width: 30, height: 30 });
    });

    it('handles elements with angle=0 correctly', () => {
      const result = getBounds([{ x: 5, y: 5, width: 10, height: 10, angle: 0 }]);
      expect(result).toEqual({ x: 5, y: 5, width: 10, height: 10 });
    });

    it('expands bounds for rotated elements', () => {
      // A 10x10 element at origin rotated 45 degrees should have larger bounds
      const result = getBounds([{ x: 0, y: 0, width: 10, height: 10, angle: Math.PI / 4 }]);
      // The diagonal of a 10x10 square is ~14.14, so bounds should be bigger
      expect(result.width).toBeGreaterThan(10);
      expect(result.height).toBeGreaterThan(10);
    });

    it('handles overlapping elements', () => {
      const result = getBounds([
        { x: 0, y: 0, width: 20, height: 20 },
        { x: 5, y: 5, width: 10, height: 10 },
      ]);
      expect(result).toEqual({ x: 0, y: 0, width: 20, height: 20 });
    });
  });

  describe('containsPoint', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };

    it('returns true for point inside bounds', () => {
      expect(containsPoint(bounds, { x: 50, y: 50 })).toBe(true);
    });

    it('returns true for point on edge', () => {
      expect(containsPoint(bounds, { x: 0, y: 0 })).toBe(true);
      expect(containsPoint(bounds, { x: 100, y: 100 })).toBe(true);
    });

    it('returns false for point outside bounds', () => {
      expect(containsPoint(bounds, { x: -1, y: 50 })).toBe(false);
      expect(containsPoint(bounds, { x: 50, y: 101 })).toBe(false);
    });

    it('returns true for point on right edge', () => {
      expect(containsPoint(bounds, { x: 100, y: 50 })).toBe(true);
    });

    it('returns true for point on bottom edge', () => {
      expect(containsPoint(bounds, { x: 50, y: 100 })).toBe(true);
    });
  });

  describe('intersects', () => {
    it('returns true for overlapping bounds', () => {
      const a = { x: 0, y: 0, width: 20, height: 20 };
      const b = { x: 10, y: 10, width: 20, height: 20 };
      expect(intersects(a, b)).toBe(true);
    });

    it('returns false for non-overlapping bounds', () => {
      const a = { x: 0, y: 0, width: 10, height: 10 };
      const b = { x: 20, y: 20, width: 10, height: 10 };
      expect(intersects(a, b)).toBe(false);
    });

    it('returns false for touching bounds (edge-to-edge)', () => {
      const a = { x: 0, y: 0, width: 10, height: 10 };
      const b = { x: 10, y: 0, width: 10, height: 10 };
      expect(intersects(a, b)).toBe(false);
    });

    it('returns true when one contains the other', () => {
      const a = { x: 0, y: 0, width: 100, height: 100 };
      const b = { x: 10, y: 10, width: 10, height: 10 };
      expect(intersects(a, b)).toBe(true);
    });

    it('is commutative', () => {
      const a = { x: 0, y: 0, width: 20, height: 20 };
      const b = { x: 10, y: 10, width: 20, height: 20 };
      expect(intersects(a, b)).toBe(intersects(b, a));
    });
  });

  describe('expandBy', () => {
    it('expands bounds by positive padding', () => {
      const bounds = { x: 10, y: 10, width: 20, height: 20 };
      expect(expandBy(bounds, 5)).toEqual({ x: 5, y: 5, width: 30, height: 30 });
    });

    it('shrinks bounds by negative padding', () => {
      const bounds = { x: 10, y: 10, width: 20, height: 20 };
      expect(expandBy(bounds, -5)).toEqual({ x: 15, y: 15, width: 10, height: 10 });
    });

    it('zero padding returns equivalent bounds', () => {
      const bounds = { x: 10, y: 10, width: 20, height: 20 };
      expect(expandBy(bounds, 0)).toEqual(bounds);
    });
  });

  describe('getCenter', () => {
    it('returns center of bounds', () => {
      expect(getCenter({ x: 0, y: 0, width: 100, height: 100 })).toEqual({ x: 50, y: 50 });
    });

    it('handles non-origin bounds', () => {
      expect(getCenter({ x: 10, y: 20, width: 30, height: 40 })).toEqual({ x: 25, y: 40 });
    });

    it('handles zero-size bounds', () => {
      expect(getCenter({ x: 5, y: 5, width: 0, height: 0 })).toEqual({ x: 5, y: 5 });
    });
  });

  describe('getCorners', () => {
    it('returns four corners in order [TL, TR, BR, BL]', () => {
      const corners = getCorners({ x: 0, y: 0, width: 10, height: 10 });
      expect(corners).toEqual([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]);
    });

    it('handles non-origin bounds', () => {
      const corners = getCorners({ x: 5, y: 10, width: 20, height: 30 });
      expect(corners).toEqual([
        { x: 5, y: 10 },
        { x: 25, y: 10 },
        { x: 25, y: 40 },
        { x: 5, y: 40 },
      ]);
    });
  });
});

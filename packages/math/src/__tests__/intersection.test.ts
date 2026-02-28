import { describe, it, expect } from 'vitest';
import {
  lineLineIntersection,
  lineRectIntersection,
  pointInRect,
  pointInEllipse,
  pointInDiamond,
  rectOverlapsRect,
} from '../intersection';

describe('intersection', () => {
  describe('lineLineIntersection', () => {
    it('finds intersection of crossing segments', () => {
      const result = lineLineIntersection(
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      );
      expect(result).not.toBeNull();
      expect(result!.x).toBeCloseTo(5);
      expect(result!.y).toBeCloseTo(5);
    });

    it('returns null for parallel segments', () => {
      const result = lineLineIntersection(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 5 },
        { x: 10, y: 5 },
      );
      expect(result).toBeNull();
    });

    it('returns null for non-intersecting segments', () => {
      const result = lineLineIntersection(
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 6, y: 1 },
        { x: 10, y: 1 },
      );
      expect(result).toBeNull();
    });

    it('finds intersection at endpoint', () => {
      const result = lineLineIntersection(
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 10, y: 0 },
      );
      expect(result).not.toBeNull();
      expect(result!.x).toBeCloseTo(5);
      expect(result!.y).toBeCloseTo(5);
    });

    it('finds intersection for perpendicular segments', () => {
      const result = lineLineIntersection(
        { x: 0, y: 5 },
        { x: 10, y: 5 },
        { x: 5, y: 0 },
        { x: 5, y: 10 },
      );
      expect(result).not.toBeNull();
      expect(result!.x).toBeCloseTo(5);
      expect(result!.y).toBeCloseTo(5);
    });
  });

  describe('lineRectIntersection', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };

    it('finds two intersections for line passing through rect', () => {
      const result = lineRectIntersection({ x: -5, y: 5 }, { x: 15, y: 5 }, rect);
      expect(result.length).toBe(2);
    });

    it('returns empty for line that misses rect', () => {
      const result = lineRectIntersection({ x: -5, y: 15 }, { x: 15, y: 15 }, rect);
      expect(result.length).toBe(0);
    });

    it('finds one intersection for line entering rect', () => {
      const result = lineRectIntersection({ x: -5, y: 5 }, { x: 5, y: 5 }, rect);
      expect(result.length).toBe(1);
      expect(result[0].x).toBeCloseTo(0);
      expect(result[0].y).toBeCloseTo(5);
    });

    it('finds intersection at corner', () => {
      const result = lineRectIntersection({ x: -5, y: -5 }, { x: 5, y: 5 }, rect);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('pointInRect', () => {
    it('returns true for point inside rect', () => {
      expect(pointInRect({ x: 5, y: 5 }, { x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    });

    it('returns true for point on edge', () => {
      expect(pointInRect({ x: 0, y: 5 }, { x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    });

    it('returns false for point outside rect', () => {
      expect(pointInRect({ x: 15, y: 5 }, { x: 0, y: 0, width: 10, height: 10 })).toBe(false);
    });

    it('handles rotated rect - point inside', () => {
      // A rect centered at (5,5) rotated 45 degrees
      const rect = { x: 0, y: 0, width: 10, height: 10, angle: Math.PI / 4 };
      // Center should always be inside
      expect(pointInRect({ x: 5, y: 5 }, rect)).toBe(true);
    });

    it('handles rotated rect - point outside', () => {
      const rect = { x: 0, y: 0, width: 10, height: 10, angle: Math.PI / 4 };
      expect(pointInRect({ x: 100, y: 100 }, rect)).toBe(false);
    });

    it('handles zero angle explicitly', () => {
      expect(pointInRect({ x: 5, y: 5 }, { x: 0, y: 0, width: 10, height: 10, angle: 0 })).toBe(
        true,
      );
    });
  });

  describe('pointInEllipse', () => {
    it('returns true for center point', () => {
      expect(pointInEllipse({ x: 5, y: 5 }, { x: 5, y: 5 }, 10, 10)).toBe(true);
    });

    it('returns false for point outside ellipse', () => {
      expect(pointInEllipse({ x: 100, y: 100 }, { x: 0, y: 0 }, 10, 10)).toBe(false);
    });

    it('returns true for point on boundary of circle', () => {
      expect(pointInEllipse({ x: 10, y: 0 }, { x: 0, y: 0 }, 10, 10)).toBe(true);
    });

    it('handles non-circular ellipse', () => {
      // Wide ellipse: rx=20, ry=5
      expect(pointInEllipse({ x: 15, y: 0 }, { x: 0, y: 0 }, 20, 5)).toBe(true);
      expect(pointInEllipse({ x: 0, y: 10 }, { x: 0, y: 0 }, 20, 5)).toBe(false);
    });

    it('returns false for zero-radius ellipse', () => {
      expect(pointInEllipse({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, 0)).toBe(false);
    });

    it('handles rotated ellipse', () => {
      // Center should be inside regardless of rotation
      expect(pointInEllipse({ x: 0, y: 0 }, { x: 0, y: 0 }, 10, 5, Math.PI / 4)).toBe(true);
      // Far away point should be outside
      expect(pointInEllipse({ x: 100, y: 100 }, { x: 0, y: 0 }, 10, 5, Math.PI / 4)).toBe(false);
    });
  });

  describe('pointInDiamond', () => {
    it('returns true for center point', () => {
      expect(pointInDiamond({ x: 0, y: 0 }, { x: 0, y: 0 }, 10, 10)).toBe(true);
    });

    it('returns true for point on vertex', () => {
      expect(pointInDiamond({ x: 5, y: 0 }, { x: 0, y: 0 }, 10, 10)).toBe(true);
    });

    it('returns false for point outside diamond', () => {
      expect(pointInDiamond({ x: 4, y: 4 }, { x: 0, y: 0 }, 10, 10)).toBe(false);
    });

    it('returns false for zero-size diamond', () => {
      expect(pointInDiamond({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, 0)).toBe(false);
    });

    it('handles rotated diamond', () => {
      expect(pointInDiamond({ x: 0, y: 0 }, { x: 0, y: 0 }, 10, 10, Math.PI / 4)).toBe(true);
      expect(pointInDiamond({ x: 100, y: 100 }, { x: 0, y: 0 }, 10, 10, Math.PI / 4)).toBe(
        false,
      );
    });

    it('handles non-square diamond', () => {
      // Wide diamond: w=20, h=10
      expect(pointInDiamond({ x: 8, y: 0 }, { x: 0, y: 0 }, 20, 10)).toBe(true);
      expect(pointInDiamond({ x: 0, y: 4 }, { x: 0, y: 0 }, 20, 10)).toBe(true);
    });
  });

  describe('rectOverlapsRect', () => {
    it('returns true for overlapping rects', () => {
      expect(
        rectOverlapsRect(
          { x: 0, y: 0, width: 20, height: 20 },
          { x: 10, y: 10, width: 20, height: 20 },
        ),
      ).toBe(true);
    });

    it('returns false for non-overlapping rects', () => {
      expect(
        rectOverlapsRect(
          { x: 0, y: 0, width: 10, height: 10 },
          { x: 20, y: 20, width: 10, height: 10 },
        ),
      ).toBe(false);
    });

    it('returns false for edge-touching rects', () => {
      expect(
        rectOverlapsRect(
          { x: 0, y: 0, width: 10, height: 10 },
          { x: 10, y: 0, width: 10, height: 10 },
        ),
      ).toBe(false);
    });

    it('returns true when one contains the other', () => {
      expect(
        rectOverlapsRect(
          { x: 0, y: 0, width: 100, height: 100 },
          { x: 25, y: 25, width: 50, height: 50 },
        ),
      ).toBe(true);
    });
  });
});

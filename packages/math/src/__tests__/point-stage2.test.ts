import { describe, it, expect } from 'vitest';
import { simplifyPoints, simplifyTuplePoints } from '../point';

describe('point - Stage 2 functions', () => {
  describe('simplifyPoints', () => {
    it('returns same points for 2 or fewer points', () => {
      const single = [{ x: 0, y: 0 }];
      expect(simplifyPoints(single, 1)).toEqual(single);

      const pair = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
      expect(simplifyPoints(pair, 1)).toEqual(pair);
    });

    it('returns original array when empty', () => {
      expect(simplifyPoints([], 1)).toEqual([]);
    });

    it('simplifies collinear points to just endpoints', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
        { x: 5, y: 0 },
      ];
      const result = simplifyPoints(points, 0.1);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ x: 0, y: 0 });
      expect(result[1]).toEqual({ x: 5, y: 0 });
    });

    it('preserves sharp corners', () => {
      // L-shaped path
      const points = [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ];
      const result = simplifyPoints(points, 0.1);
      expect(result).toHaveLength(3);
      expect(result[1]).toEqual({ x: 5, y: 0 });
    });

    it('reduces points with high tolerance', () => {
      // Sine-wave-like path
      const points = [];
      for (let i = 0; i <= 100; i++) {
        points.push({
          x: i,
          y: Math.sin(i * 0.1) * 5,
        });
      }

      const simplified = simplifyPoints(points, 2);
      expect(simplified.length).toBeLessThan(points.length);
      expect(simplified.length).toBeGreaterThan(2);
    });

    it('preserves all points with zero tolerance', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
        { x: 3, y: 1 },
      ];
      // With zero tolerance, all points that deviate should be kept
      const result = simplifyPoints(points, 0);
      expect(result.length).toBe(4);
    });

    it('preserves first and last points', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 5, y: 3 },
        { x: 10, y: 0 },
        { x: 15, y: 2 },
        { x: 20, y: 0 },
      ];
      const result = simplifyPoints(points, 5);
      expect(result[0]).toEqual({ x: 0, y: 0 });
      expect(result[result.length - 1]).toEqual({ x: 20, y: 0 });
    });
  });

  describe('simplifyTuplePoints', () => {
    it('simplifies tuple-format points', () => {
      const points: [number, number][] = [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [4, 0],
      ];
      const result = simplifyTuplePoints(points, 0.1);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual([0, 0]);
      expect(result[1]).toEqual([4, 0]);
    });

    it('preserves corners in tuple format', () => {
      const points: [number, number][] = [
        [0, 0],
        [5, 0],
        [5, 5],
      ];
      const result = simplifyTuplePoints(points, 0.1);
      expect(result).toHaveLength(3);
    });

    it('returns correct tuple format', () => {
      const points: [number, number][] = [
        [10, 20],
        [30, 40],
      ];
      const result = simplifyTuplePoints(points, 1);
      expect(Array.isArray(result[0])).toBe(true);
      expect(result[0]).toHaveLength(2);
    });
  });
});

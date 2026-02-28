import { describe, it, expect } from 'vitest';
import { quadraticPoint, cubicPoint, quadraticLength, cubicLength, splitCubic } from '../bezier';

describe('bezier', () => {
  describe('quadraticPoint', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 5, y: 10 };
    const p2 = { x: 10, y: 0 };

    it('returns start point at t=0', () => {
      const result = quadraticPoint(p0, p1, p2, 0);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });

    it('returns end point at t=1', () => {
      const result = quadraticPoint(p0, p1, p2, 1);
      expect(result.x).toBeCloseTo(10);
      expect(result.y).toBeCloseTo(0);
    });

    it('returns midpoint at t=0.5', () => {
      const result = quadraticPoint(p0, p1, p2, 0.5);
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(5);
    });

    it('returns correct point for straight line', () => {
      // When control point is on the line, the curve is a straight line
      const result = quadraticPoint({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }, 0.5);
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(5);
    });
  });

  describe('cubicPoint', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 0, y: 10 };
    const p2 = { x: 10, y: 10 };
    const p3 = { x: 10, y: 0 };

    it('returns start point at t=0', () => {
      const result = cubicPoint(p0, p1, p2, p3, 0);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });

    it('returns end point at t=1', () => {
      const result = cubicPoint(p0, p1, p2, p3, 1);
      expect(result.x).toBeCloseTo(10);
      expect(result.y).toBeCloseTo(0);
    });

    it('returns midpoint at t=0.5 for symmetric curve', () => {
      const result = cubicPoint(p0, p1, p2, p3, 0.5);
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(7.5);
    });

    it('returns correct point for straight line', () => {
      const result = cubicPoint(
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
        { x: 15, y: 15 },
        0.5,
      );
      expect(result.x).toBeCloseTo(7.5);
      expect(result.y).toBeCloseTo(7.5);
    });
  });

  describe('quadraticLength', () => {
    it('computes correct length for straight line', () => {
      const len = quadraticLength({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 });
      expect(len).toBeCloseTo(10, 1);
    });

    it('curve length is greater than straight-line distance', () => {
      const len = quadraticLength({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 });
      // Straight-line distance is 10, curve should be longer
      expect(len).toBeGreaterThan(10);
    });

    it('returns 0 for single point', () => {
      const len = quadraticLength({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 });
      expect(len).toBeCloseTo(0);
    });
  });

  describe('cubicLength', () => {
    it('computes correct length for straight line', () => {
      const len = cubicLength(
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 15, y: 0 },
      );
      expect(len).toBeCloseTo(15, 1);
    });

    it('curve length is greater than chord', () => {
      const len = cubicLength(
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
      );
      // Straight-line distance is 10, curve should be longer
      expect(len).toBeGreaterThan(10);
    });
  });

  describe('splitCubic', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 0, y: 10 };
    const p2 = { x: 10, y: 10 };
    const p3 = { x: 10, y: 0 };

    it('left segment starts at original start', () => {
      const [left] = splitCubic(p0, p1, p2, p3, 0.5);
      expect(left.p0.x).toBeCloseTo(0);
      expect(left.p0.y).toBeCloseTo(0);
    });

    it('right segment ends at original end', () => {
      const [, right] = splitCubic(p0, p1, p2, p3, 0.5);
      expect(right.p3.x).toBeCloseTo(10);
      expect(right.p3.y).toBeCloseTo(0);
    });

    it('left end matches right start (continuity)', () => {
      const [left, right] = splitCubic(p0, p1, p2, p3, 0.5);
      expect(left.p3.x).toBeCloseTo(right.p0.x);
      expect(left.p3.y).toBeCloseTo(right.p0.y);
    });

    it('split point matches cubicPoint at same t', () => {
      const t = 0.3;
      const [left] = splitCubic(p0, p1, p2, p3, t);
      const expectedPoint = cubicPoint(p0, p1, p2, p3, t);
      expect(left.p3.x).toBeCloseTo(expectedPoint.x);
      expect(left.p3.y).toBeCloseTo(expectedPoint.y);
    });

    it('split at t=0 gives degenerate left segment', () => {
      const [left] = splitCubic(p0, p1, p2, p3, 0);
      expect(left.p0.x).toBeCloseTo(left.p3.x);
      expect(left.p0.y).toBeCloseTo(left.p3.y);
    });

    it('split at t=1 gives degenerate right segment', () => {
      const [, right] = splitCubic(p0, p1, p2, p3, 1);
      expect(right.p0.x).toBeCloseTo(right.p3.x);
      expect(right.p0.y).toBeCloseTo(right.p3.y);
    });
  });
});

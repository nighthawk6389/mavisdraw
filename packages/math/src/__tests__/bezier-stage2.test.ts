import { describe, it, expect } from 'vitest';
import {
  evaluateBezier,
  splitBezier,
  projectPointOnBezier,
  getBezierBounds,
  getCubicControlPoints,
  cubicPoint,
} from '../bezier';

describe('bezier - Stage 2 functions', () => {
  describe('evaluateBezier', () => {
    it('evaluates a linear segment (2 points)', () => {
      const result = evaluateBezier(
        [{ x: 0, y: 0 }, { x: 10, y: 10 }],
        0.5,
      );
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(5);
    });

    it('evaluates a quadratic bezier (3 points)', () => {
      const result = evaluateBezier(
        [{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }],
        0.5,
      );
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(5);
    });

    it('evaluates a cubic bezier (4 points)', () => {
      const result = evaluateBezier(
        [
          { x: 0, y: 0 },
          { x: 0, y: 10 },
          { x: 10, y: 10 },
          { x: 10, y: 0 },
        ],
        0,
      );
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });

    it('returns end point at t=1 for all types', () => {
      const result2 = evaluateBezier(
        [{ x: 0, y: 0 }, { x: 10, y: 20 }],
        1,
      );
      expect(result2.x).toBeCloseTo(10);
      expect(result2.y).toBeCloseTo(20);

      const result3 = evaluateBezier(
        [{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }],
        1,
      );
      expect(result3.x).toBeCloseTo(10);
      expect(result3.y).toBeCloseTo(0);
    });

    it('throws for invalid point count', () => {
      expect(() => evaluateBezier([{ x: 0, y: 0 }], 0.5)).toThrow();
      expect(() =>
        evaluateBezier(
          [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 2 },
            { x: 3, y: 3 },
            { x: 4, y: 4 },
          ],
          0.5,
        ),
      ).toThrow();
    });
  });

  describe('splitBezier', () => {
    const points: [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ] = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ];

    it('left segment starts at original start', () => {
      const [left] = splitBezier(points, 0.5);
      expect(left[0].x).toBeCloseTo(0);
      expect(left[0].y).toBeCloseTo(0);
    });

    it('right segment ends at original end', () => {
      const [, right] = splitBezier(points, 0.5);
      expect(right[3].x).toBeCloseTo(10);
      expect(right[3].y).toBeCloseTo(0);
    });

    it('left end matches right start', () => {
      const [left, right] = splitBezier(points, 0.5);
      expect(left[3].x).toBeCloseTo(right[0].x);
      expect(left[3].y).toBeCloseTo(right[0].y);
    });

    it('split point matches cubicPoint at same t', () => {
      const t = 0.3;
      const [left] = splitBezier(points, t);
      const expected = cubicPoint(points[0], points[1], points[2], points[3], t);
      expect(left[3].x).toBeCloseTo(expected.x);
      expect(left[3].y).toBeCloseTo(expected.y);
    });

    it('returns 4 points per segment', () => {
      const [left, right] = splitBezier(points, 0.5);
      expect(left).toHaveLength(4);
      expect(right).toHaveLength(4);
    });
  });

  describe('projectPointOnBezier', () => {
    const bezier: [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ] = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ];

    it('projects start point to t=0', () => {
      const result = projectPointOnBezier({ x: 0, y: 0 }, bezier);
      expect(result.t).toBeCloseTo(0, 1);
      expect(result.distance).toBeCloseTo(0, 0);
    });

    it('projects end point to t=1', () => {
      const result = projectPointOnBezier({ x: 10, y: 0 }, bezier);
      expect(result.t).toBeCloseTo(1, 1);
      expect(result.distance).toBeCloseTo(0, 0);
    });

    it('projects point on curve to small distance', () => {
      // Point at t=0.5 should project back to approximately t=0.5
      const onCurve = cubicPoint(bezier[0], bezier[1], bezier[2], bezier[3], 0.5);
      const result = projectPointOnBezier(onCurve, bezier);
      expect(result.distance).toBeCloseTo(0, 0);
      expect(result.t).toBeCloseTo(0.5, 1);
    });

    it('point far from curve has larger distance', () => {
      const result = projectPointOnBezier({ x: 5, y: -20 }, bezier);
      expect(result.distance).toBeGreaterThan(10);
    });
  });

  describe('getBezierBounds', () => {
    it('computes bounds for a symmetric curve', () => {
      const bezier: [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ] = [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
      ];

      const bounds = getBezierBounds(bezier);
      expect(bounds.x).toBeLessThanOrEqual(0);
      expect(bounds.y).toBeLessThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(10);
      expect(bounds.y + bounds.height).toBeGreaterThan(0);
    });

    it('computes bounds for a straight line', () => {
      const bezier: [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ] = [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 15, y: 0 },
      ];

      const bounds = getBezierBounds(bezier);
      expect(bounds.x).toBeCloseTo(0);
      expect(bounds.width).toBeCloseTo(15);
      expect(bounds.height).toBeCloseTo(0, 0);
    });
  });

  describe('getCubicControlPoints', () => {
    it('returns 4 control points', () => {
      const result = getCubicControlPoints({ x: 0, y: 0 }, { x: 100, y: 100 });
      expect(result).toHaveLength(4);
    });

    it('start and end match input points', () => {
      const start = { x: 10, y: 20 };
      const end = { x: 100, y: 80 };
      const [p0, , , p3] = getCubicControlPoints(start, end);
      expect(p0).toEqual(start);
      expect(p3).toEqual(end);
    });

    it('control points have perpendicular offset for horizontal line', () => {
      const start = { x: 0, y: 0 };
      const end = { x: 100, y: 0 };
      const [, cp1, cp2] = getCubicControlPoints(start, end, 0.5);

      expect(cp1.x).toBeCloseTo(100 / 3, 0);
      expect(cp1.y).not.toBeCloseTo(0);
      expect(cp2.x).toBeCloseTo(200 / 3, 0);
      expect(cp2.y).not.toBeCloseTo(0);
    });

    it('control points have perpendicular offset for vertical line', () => {
      const start = { x: 0, y: 0 };
      const end = { x: 0, y: 100 };
      const [, cp1, cp2] = getCubicControlPoints(start, end, 0.5);

      expect(cp1.y).toBeCloseTo(100 / 3, 0);
      expect(cp1.x).not.toBeCloseTo(0);
      expect(cp2.y).toBeCloseTo(200 / 3, 0);
      expect(cp2.x).not.toBeCloseTo(0);
    });

    it('with zero curvature, control points collapse to straight line', () => {
      const start = { x: 0, y: 0 };
      const end = { x: 100, y: 0 };
      const [, cp1, cp2] = getCubicControlPoints(start, end, 0);
      expect(cp1.x).toBeCloseTo(100 / 3);
      expect(cp1.y).toBeCloseTo(0);
      expect(cp2.x).toBeCloseTo(200 / 3);
      expect(cp2.y).toBeCloseTo(0);
    });

    it('handles coincident points', () => {
      const point = { x: 50, y: 50 };
      const [p0, cp1, cp2, p3] = getCubicControlPoints(point, point);
      expect(p0).toEqual(point);
      expect(p3).toEqual(point);
    });

    it('produces a visible arc for diagonal line', () => {
      const start = { x: 0, y: 0 };
      const end = { x: 100, y: 100 };
      const [, cp1, cp2] = getCubicControlPoints(start, end, 0.5);
      const dist = Math.sqrt(100 * 100 + 100 * 100);
      const expectedOffset = dist * 0.5 * 0.4;
      expect(cp1.x).toBeLessThan(100 / 3 + 1);
      expect(cp1.y).toBeGreaterThan(100 / 3 - 1);
    });
  });
});

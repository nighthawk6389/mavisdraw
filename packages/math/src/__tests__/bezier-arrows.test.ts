import { describe, it, expect } from 'vitest';
import { getCubicControlPoints, cubicPoint, projectPointOnBezier } from '../bezier';

describe('getCubicControlPoints', () => {
  it('horizontal line: perpendicular offset is purely in Y direction', () => {
    const [, cp1, cp2] = getCubicControlPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5);
    const perpOffset = 100 * 0.5 * 0.4;

    expect(cp1.x).toBeCloseTo(100 / 3);
    expect(cp1.y).toBeCloseTo(perpOffset);
    expect(cp2.x).toBeCloseTo(200 / 3);
    expect(cp2.y).toBeCloseTo(perpOffset);
  });

  it('vertical line: perpendicular offset is purely in X direction', () => {
    const [, cp1, cp2] = getCubicControlPoints({ x: 0, y: 0 }, { x: 0, y: 100 }, 0.5);
    const perpOffset = 100 * 0.5 * 0.4;

    expect(cp1.x).toBeCloseTo(-perpOffset);
    expect(cp1.y).toBeCloseTo(100 / 3);
    expect(cp2.x).toBeCloseTo(-perpOffset);
    expect(cp2.y).toBeCloseTo(200 / 3);
  });

  it('45-degree diagonal: perpendicular offset splits across both axes', () => {
    const dist = Math.sqrt(100 * 100 + 100 * 100);
    const perpOffset = dist * 0.5 * 0.4;
    const invSqrt2 = 1 / Math.sqrt(2);

    const [, cp1, cp2] = getCubicControlPoints({ x: 0, y: 0 }, { x: 100, y: 100 }, 0.5);

    expect(cp1.x).toBeCloseTo(invSqrt2 * dist / 3 + (-invSqrt2) * perpOffset);
    expect(cp1.y).toBeCloseTo(invSqrt2 * dist / 3 + invSqrt2 * perpOffset);
    expect(cp2.x).toBeCloseTo(invSqrt2 * dist * 2 / 3 + (-invSqrt2) * perpOffset);
    expect(cp2.y).toBeCloseTo(invSqrt2 * dist * 2 / 3 + invSqrt2 * perpOffset);
  });

  it('negative direction (end.x < start.x): flips perpendicular direction', () => {
    const [, cp1Forward] = getCubicControlPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5);
    const [, cp1Reverse] = getCubicControlPoints({ x: 100, y: 0 }, { x: 0, y: 0 }, 0.5);

    expect(cp1Forward.y).toBeGreaterThan(0);
    expect(cp1Reverse.y).toBeLessThan(0);
  });

  it('very short line (distance < 5px): produces small but valid offsets', () => {
    const [p0, cp1, cp2, p3] = getCubicControlPoints({ x: 0, y: 0 }, { x: 2, y: 0 }, 0.5);
    const perpOffset = 2 * 0.5 * 0.4;

    expect(p0).toEqual({ x: 0, y: 0 });
    expect(p3).toEqual({ x: 2, y: 0 });
    expect(cp1.y).toBeCloseTo(perpOffset);
    expect(Math.abs(cp1.y)).toBeLessThan(1);
  });

  it('large curvature (1.0): produces larger perpendicular offset', () => {
    const [, cp1Large] = getCubicControlPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 1.0);
    const [, cp1Small] = getCubicControlPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.1);

    expect(Math.abs(cp1Large.y)).toBeGreaterThan(Math.abs(cp1Small.y));
    expect(cp1Large.y).toBeCloseTo(100 * 1.0 * 0.4);
  });

  it('small curvature (0.1): produces near-straight control points', () => {
    const [, cp1, cp2] = getCubicControlPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.1);
    const perpOffset = 100 * 0.1 * 0.4;

    expect(cp1.y).toBeCloseTo(perpOffset);
    expect(perpOffset).toBeCloseTo(4);
    expect(cp1.x).toBeCloseTo(100 / 3);
  });
});

describe('cubicPoint sampling along the curve', () => {
  it('t=0 returns start point', () => {
    const [p0, p1, p2, p3] = getCubicControlPoints({ x: 10, y: 20 }, { x: 200, y: 150 }, 0.6);
    const result = cubicPoint(p0, p1, p2, p3, 0);

    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(20);
  });

  it('t=1 returns end point', () => {
    const [p0, p1, p2, p3] = getCubicControlPoints({ x: 10, y: 20 }, { x: 200, y: 150 }, 0.6);
    const result = cubicPoint(p0, p1, p2, p3, 1);

    expect(result.x).toBeCloseTo(200);
    expect(result.y).toBeCloseTo(150);
  });

  it('t=0.5 is offset from the straight-line midpoint for non-zero curvature', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 0 };
    const [p0, p1, p2, p3] = getCubicControlPoints(start, end, 0.5);
    const mid = cubicPoint(p0, p1, p2, p3, 0.5);

    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).not.toBeCloseTo(0);
    expect(mid.y).toBeGreaterThan(0);
  });

  it('t=0.5 on a zero-curvature curve lies on the straight-line midpoint', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 0 };
    const [p0, p1, p2, p3] = getCubicControlPoints(start, end, 0);
    const mid = cubicPoint(p0, p1, p2, p3, 0.5);

    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(0);
  });
});

describe('projectPointOnBezier with generated control points', () => {
  it('point on the curve projects with near-zero distance', () => {
    const bezier = getCubicControlPoints({ x: 0, y: 0 }, { x: 200, y: 100 }, 0.7);
    const onCurve = cubicPoint(bezier[0], bezier[1], bezier[2], bezier[3], 0.4);
    const result = projectPointOnBezier(onCurve, bezier);

    expect(result.distance).toBeLessThan(0.5);
    expect(result.t).toBeCloseTo(0.4, 1);
  });

  it('point far from the curve has a large distance', () => {
    const bezier = getCubicControlPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5);
    const result = projectPointOnBezier({ x: 50, y: 500 }, bezier);

    expect(result.distance).toBeGreaterThan(400);
  });

  it('projects start and end points accurately on a generated curve', () => {
    const start = { x: 30, y: 40 };
    const end = { x: 300, y: 200 };
    const bezier = getCubicControlPoints(start, end, 0.5);

    const startProj = projectPointOnBezier(start, bezier);
    expect(startProj.distance).toBeLessThan(0.5);
    expect(startProj.t).toBeCloseTo(0, 1);

    const endProj = projectPointOnBezier(end, bezier);
    expect(endProj.distance).toBeLessThan(0.5);
    expect(endProj.t).toBeCloseTo(1, 1);
  });

  it('nearest point lies between curve endpoints for a perpendicular offset point', () => {
    const bezier = getCubicControlPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5);
    const result = projectPointOnBezier({ x: 50, y: -10 }, bezier);

    expect(result.t).toBeGreaterThan(0.1);
    expect(result.t).toBeLessThan(0.9);
  });
});

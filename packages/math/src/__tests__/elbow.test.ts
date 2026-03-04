import { describe, it, expect } from 'vitest';
import { getConnectionSide, calculateElbowRoute } from '../elbow';

describe('getConnectionSide', () => {
  // Rectangle at (100, 100) with width=200, height=100
  const x = 100, y = 100, w = 200, h = 100;

  it('returns top when point is near top edge', () => {
    expect(getConnectionSide(200, 100, x, y, w, h)).toBe('top');
  });

  it('returns bottom when point is near bottom edge', () => {
    expect(getConnectionSide(200, 200, x, y, w, h)).toBe('bottom');
  });

  it('returns left when point is near left edge', () => {
    expect(getConnectionSide(100, 150, x, y, w, h)).toBe('left');
  });

  it('returns right when point is near right edge', () => {
    expect(getConnectionSide(300, 150, x, y, w, h)).toBe('right');
  });

  it('handles corner — picks top over left when equidistant (top wins)', () => {
    // At top-left corner (100, 100), distTop=0, distLeft=0 — top wins (checked first)
    const side = getConnectionSide(100, 100, x, y, w, h);
    expect(side).toBe('top');
  });

  it('handles point at center of bottom edge', () => {
    expect(getConnectionSide(200, 200, x, y, w, h)).toBe('bottom');
  });
});

describe('calculateElbowRoute', () => {
  it('returns straight line for nearly aligned points (vertical)', () => {
    const start: [number, number] = [100, 100];
    const end: [number, number] = [102, 300];
    const result = calculateElbowRoute(start, end);
    expect(result).toEqual([start, end]);
  });

  it('returns straight line for nearly aligned points (horizontal)', () => {
    const start: [number, number] = [100, 100];
    const end: [number, number] = [400, 103];
    const result = calculateElbowRoute(start, end);
    expect(result).toEqual([start, end]);
  });

  it('uses horizontal-first heuristic when |dx| > |dy| and no directions', () => {
    const start: [number, number] = [0, 0];
    const end: [number, number] = [200, 100];
    const result = calculateElbowRoute(start, end);
    // Midpoint heuristic: midX = 100
    expect(result).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [200, 100],
    ]);
  });

  it('uses vertical-first heuristic when |dy| > |dx| and no directions', () => {
    const start: [number, number] = [0, 0];
    const end: [number, number] = [100, 200];
    const result = calculateElbowRoute(start, end);
    // Midpoint heuristic: midY = 100
    expect(result).toEqual([
      [0, 0],
      [0, 100],
      [100, 100],
      [100, 200],
    ]);
  });

  it('routes upward first when startDir is top', () => {
    const start: [number, number] = [0, 0];
    const end: [number, number] = [200, -50];
    const result = calculateElbowRoute(start, end, 'top');
    // Should depart upward (y - MARGIN), then horizontal to end
    expect(result[0]).toEqual([0, 0]);
    expect(result[1][0]).toBe(0); // same x
    expect(result[1][1]).toBeLessThan(0); // moved up
    // Last point is end
    expect(result[result.length - 1]).toEqual([200, -50]);
  });

  it('routes rightward first when startDir is right', () => {
    const start: [number, number] = [0, 0];
    const end: [number, number] = [200, 100];
    const result = calculateElbowRoute(start, end, 'right');
    expect(result[0]).toEqual([0, 0]);
    expect(result[1][0]).toBeGreaterThan(0); // moved right
    expect(result[1][1]).toBe(0); // same y
    expect(result[result.length - 1]).toEqual([200, 100]);
  });

  it('routes with both directions', () => {
    const start: [number, number] = [0, 0];
    const end: [number, number] = [200, 100];
    const result = calculateElbowRoute(start, end, 'top', 'right');
    expect(result[0]).toEqual([0, 0]);
    expect(result[result.length - 1]).toEqual([200, 100]);
    // All segments should be axis-aligned
    for (let i = 0; i < result.length - 1; i++) {
      const dx = Math.abs(result[i + 1][0] - result[i][0]);
      const dy = Math.abs(result[i + 1][1] - result[i][1]);
      expect(dx === 0 || dy === 0).toBe(true);
    }
  });

  it('routes with endDir only', () => {
    const start: [number, number] = [0, 0];
    const end: [number, number] = [200, 100];
    const result = calculateElbowRoute(start, end, null, 'bottom');
    expect(result[0]).toEqual([0, 0]);
    expect(result[result.length - 1]).toEqual([200, 100]);
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it('all segments are right-angle (axis-aligned)', () => {
    const start: [number, number] = [50, 50];
    const end: [number, number] = [300, 200];
    const result = calculateElbowRoute(start, end, 'left', 'top');
    for (let i = 0; i < result.length - 1; i++) {
      const dx = Math.abs(result[i + 1][0] - result[i][0]);
      const dy = Math.abs(result[i + 1][1] - result[i][1]);
      expect(dx === 0 || dy === 0).toBe(true);
    }
  });
});

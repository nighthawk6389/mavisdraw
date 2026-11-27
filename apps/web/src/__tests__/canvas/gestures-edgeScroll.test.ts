import { describe, it, expect } from 'vitest';
import {
  EDGE_SCROLL_DEFAULTS,
  edgeProximity,
  edgeScrollStep,
} from '../../components/canvas/gestures/edgeScroll';

const size = { width: 1000, height: 600 };

describe('edge scrolling', () => {
  it('is idle away from the edges', () => {
    expect(edgeProximity({ x: 500, y: 300 }, size)).toEqual({ x: 0, y: 0 });
    expect(edgeScrollStep({ x: 500, y: 300 }, size, 10_000, 16)).toEqual({ x: 0, y: 0 });
  });

  it('points toward the nearest edge, stronger the closer the pointer', () => {
    const near = edgeProximity({ x: 990, y: 300 }, size);
    const nearer = edgeProximity({ x: 999, y: 300 }, size);
    expect(near.x).toBeGreaterThan(0);
    expect(nearer.x).toBeGreaterThan(near.x);
    expect(edgeProximity({ x: 300, y: 5 }, size).y).toBeLessThan(0);
  });

  it('is at full strength once the pointer leaves the canvas', () => {
    expect(edgeProximity({ x: 1200, y: -50 }, size)).toEqual({ x: 1, y: -1 });
  });

  it('waits before scrolling, then eases in', () => {
    const p = { x: 1100, y: 300 };
    expect(edgeScrollStep(p, size, EDGE_SCROLL_DEFAULTS.delay - 1, 16).x).toBe(0);
    const early = edgeScrollStep(p, size, EDGE_SCROLL_DEFAULTS.delay + 50, 16).x;
    const late = edgeScrollStep(p, size, EDGE_SCROLL_DEFAULTS.delay + 1000, 16).x;
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early);
  });

  it('moves the same distance per second at any frame rate', () => {
    const p = { x: 1100, y: 300 };
    const at60 = edgeScrollStep(p, size, 5000, 1000 / 60).x * 60;
    const at120 = edgeScrollStep(p, size, 5000, 1000 / 120).x * 120;
    expect(at120).toBeCloseTo(at60);
  });
});

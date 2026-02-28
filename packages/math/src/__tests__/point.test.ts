import { describe, it, expect } from 'vitest';
import { distance, midpoint, add, subtract, scale, rotate, lerp } from '../point';

describe('point', () => {
  describe('distance', () => {
    it('returns 0 for identical points', () => {
      expect(distance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
    });

    it('computes horizontal distance', () => {
      expect(distance({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3);
    });

    it('computes vertical distance', () => {
      expect(distance({ x: 0, y: 0 }, { x: 0, y: 4 })).toBe(4);
    });

    it('computes diagonal distance (3-4-5 triangle)', () => {
      expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    });

    it('handles negative coordinates', () => {
      expect(distance({ x: -3, y: -4 }, { x: 0, y: 0 })).toBe(5);
    });
  });

  describe('midpoint', () => {
    it('computes midpoint of two points', () => {
      expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 10 })).toEqual({ x: 5, y: 5 });
    });

    it('returns same point when both points are identical', () => {
      expect(midpoint({ x: 3, y: 7 }, { x: 3, y: 7 })).toEqual({ x: 3, y: 7 });
    });

    it('handles negative coordinates', () => {
      expect(midpoint({ x: -10, y: -10 }, { x: 10, y: 10 })).toEqual({ x: 0, y: 0 });
    });
  });

  describe('add', () => {
    it('adds two points', () => {
      expect(add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    });

    it('adding zero point returns same point', () => {
      expect(add({ x: 5, y: 7 }, { x: 0, y: 0 })).toEqual({ x: 5, y: 7 });
    });

    it('handles negative values', () => {
      expect(add({ x: 5, y: 5 }, { x: -3, y: -2 })).toEqual({ x: 2, y: 3 });
    });
  });

  describe('subtract', () => {
    it('subtracts two points', () => {
      expect(subtract({ x: 5, y: 7 }, { x: 2, y: 3 })).toEqual({ x: 3, y: 4 });
    });

    it('subtracting a point from itself returns zero', () => {
      expect(subtract({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 0, y: 0 });
    });
  });

  describe('scale', () => {
    it('scales a point by a factor', () => {
      expect(scale({ x: 3, y: 4 }, 2)).toEqual({ x: 6, y: 8 });
    });

    it('scaling by 0 returns origin', () => {
      expect(scale({ x: 5, y: 7 }, 0)).toEqual({ x: 0, y: 0 });
    });

    it('scaling by 1 returns same point', () => {
      expect(scale({ x: 5, y: 7 }, 1)).toEqual({ x: 5, y: 7 });
    });

    it('scaling by negative flips the point', () => {
      expect(scale({ x: 3, y: 4 }, -1)).toEqual({ x: -3, y: -4 });
    });

    it('scales by fractional values', () => {
      expect(scale({ x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
    });
  });

  describe('rotate', () => {
    it('rotating by 0 returns the same point', () => {
      const p = { x: 5, y: 0 };
      const center = { x: 0, y: 0 };
      const result = rotate(p, center, 0);
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(0);
    });

    it('rotates 90 degrees counter-clockwise', () => {
      const p = { x: 1, y: 0 };
      const center = { x: 0, y: 0 };
      const result = rotate(p, center, Math.PI / 2);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(1);
    });

    it('rotates 180 degrees', () => {
      const p = { x: 1, y: 0 };
      const center = { x: 0, y: 0 };
      const result = rotate(p, center, Math.PI);
      expect(result.x).toBeCloseTo(-1);
      expect(result.y).toBeCloseTo(0);
    });

    it('rotates around a non-origin center', () => {
      const p = { x: 10, y: 5 };
      const center = { x: 5, y: 5 };
      const result = rotate(p, center, Math.PI / 2);
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(10);
    });

    it('full rotation returns to original position', () => {
      const p = { x: 3, y: 4 };
      const center = { x: 1, y: 1 };
      const result = rotate(p, center, Math.PI * 2);
      expect(result.x).toBeCloseTo(3);
      expect(result.y).toBeCloseTo(4);
    });
  });

  describe('lerp', () => {
    it('at t=0 returns the first point', () => {
      expect(lerp({ x: 0, y: 0 }, { x: 10, y: 10 }, 0)).toEqual({ x: 0, y: 0 });
    });

    it('at t=1 returns the second point', () => {
      expect(lerp({ x: 0, y: 0 }, { x: 10, y: 10 }, 1)).toEqual({ x: 10, y: 10 });
    });

    it('at t=0.5 returns the midpoint', () => {
      expect(lerp({ x: 0, y: 0 }, { x: 10, y: 10 }, 0.5)).toEqual({ x: 5, y: 5 });
    });

    it('at t=0.25 returns quarter point', () => {
      expect(lerp({ x: 0, y: 0 }, { x: 100, y: 200 }, 0.25)).toEqual({ x: 25, y: 50 });
    });

    it('handles extrapolation (t > 1)', () => {
      expect(lerp({ x: 0, y: 0 }, { x: 10, y: 10 }, 2)).toEqual({ x: 20, y: 20 });
    });
  });
});

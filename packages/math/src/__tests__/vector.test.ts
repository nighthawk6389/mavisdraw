import { describe, it, expect } from 'vitest';
import { length, normalize, dot, cross, perpendicular, angleBetween } from '../vector';

describe('vector', () => {
  describe('length', () => {
    it('returns 0 for zero vector', () => {
      expect(length({ x: 0, y: 0 })).toBe(0);
    });

    it('computes length of unit vectors', () => {
      expect(length({ x: 1, y: 0 })).toBe(1);
      expect(length({ x: 0, y: 1 })).toBe(1);
    });

    it('computes length of 3-4-5 vector', () => {
      expect(length({ x: 3, y: 4 })).toBe(5);
    });

    it('handles negative components', () => {
      expect(length({ x: -3, y: -4 })).toBe(5);
    });
  });

  describe('normalize', () => {
    it('returns zero vector for zero input', () => {
      expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    });

    it('normalizes a horizontal vector', () => {
      const result = normalize({ x: 5, y: 0 });
      expect(result.x).toBeCloseTo(1);
      expect(result.y).toBeCloseTo(0);
    });

    it('normalizes a diagonal vector', () => {
      const result = normalize({ x: 3, y: 4 });
      expect(result.x).toBeCloseTo(0.6);
      expect(result.y).toBeCloseTo(0.8);
    });

    it('result has length 1', () => {
      const result = normalize({ x: 7, y: 11 });
      expect(length(result)).toBeCloseTo(1);
    });
  });

  describe('dot', () => {
    it('dot product of perpendicular vectors is 0', () => {
      expect(dot({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(0);
    });

    it('dot product of parallel vectors equals product of lengths', () => {
      expect(dot({ x: 3, y: 0 }, { x: 5, y: 0 })).toBe(15);
    });

    it('dot product of anti-parallel vectors is negative', () => {
      expect(dot({ x: 1, y: 0 }, { x: -1, y: 0 })).toBe(-1);
    });

    it('computes general dot product', () => {
      expect(dot({ x: 2, y: 3 }, { x: 4, y: 5 })).toBe(23);
    });
  });

  describe('cross', () => {
    it('cross product of parallel vectors is 0', () => {
      expect(cross({ x: 2, y: 0 }, { x: 5, y: 0 })).toBe(0);
    });

    it('positive for counter-clockwise', () => {
      expect(cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1);
    });

    it('negative for clockwise', () => {
      expect(cross({ x: 0, y: 1 }, { x: 1, y: 0 })).toBe(-1);
    });

    it('computes general cross product', () => {
      expect(cross({ x: 2, y: 3 }, { x: 4, y: 5 })).toBe(2 * 5 - 3 * 4);
    });
  });

  describe('perpendicular', () => {
    it('returns perpendicular of x-axis vector', () => {
      const result = perpendicular({ x: 1, y: 0 });
      expect(result.x).toBe(-0); // -0 from negating y=0
      expect(result.y).toBe(1);
    });

    it('returns perpendicular of y-axis vector', () => {
      expect(perpendicular({ x: 0, y: 1 })).toEqual({ x: -1, y: 0 });
    });

    it('result is perpendicular (dot product is 0)', () => {
      const v = { x: 3, y: 7 };
      const p = perpendicular(v);
      expect(dot(v, p)).toBe(0);
    });

    it('preserves length', () => {
      const v = { x: 3, y: 4 };
      expect(length(perpendicular(v))).toBeCloseTo(length(v));
    });
  });

  describe('angleBetween', () => {
    it('returns 0 for parallel vectors', () => {
      expect(angleBetween({ x: 1, y: 0 }, { x: 5, y: 0 })).toBeCloseTo(0);
    });

    it('returns PI/2 for perpendicular vectors', () => {
      expect(angleBetween({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2);
    });

    it('returns PI for anti-parallel vectors', () => {
      expect(angleBetween({ x: 1, y: 0 }, { x: -1, y: 0 })).toBeCloseTo(Math.PI);
    });

    it('returns 0 when either vector is zero', () => {
      expect(angleBetween({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(0);
      expect(angleBetween({ x: 1, y: 1 }, { x: 0, y: 0 })).toBe(0);
    });

    it('computes angle for 45 degree vectors', () => {
      expect(angleBetween({ x: 1, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(Math.PI / 4);
    });
  });
});

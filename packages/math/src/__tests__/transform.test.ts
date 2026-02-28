import { describe, it, expect } from 'vitest';
import {
  createIdentity,
  translate,
  scaleMatrix,
  rotateMatrix,
  applyToPoint,
  inverse,
  screenToCanvas,
  canvasToScreen,
} from '../transform';

describe('transform', () => {
  describe('createIdentity', () => {
    it('creates an identity matrix', () => {
      expect(createIdentity()).toEqual([1, 0, 0, 1, 0, 0]);
    });

    it('identity matrix does not change points', () => {
      const m = createIdentity();
      const p = { x: 5, y: 10 };
      expect(applyToPoint(m, p)).toEqual(p);
    });
  });

  describe('translate', () => {
    it('translates a point', () => {
      const m = translate(createIdentity(), 10, 20);
      expect(applyToPoint(m, { x: 0, y: 0 })).toEqual({ x: 10, y: 20 });
    });

    it('adds to existing translation', () => {
      let m = translate(createIdentity(), 10, 20);
      m = translate(m, 5, 5);
      expect(applyToPoint(m, { x: 0, y: 0 })).toEqual({ x: 15, y: 25 });
    });

    it('translates with negative values', () => {
      const m = translate(createIdentity(), -5, -10);
      expect(applyToPoint(m, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
    });
  });

  describe('scaleMatrix', () => {
    it('scales a point by factor', () => {
      const m = scaleMatrix(createIdentity(), 2, 3);
      expect(applyToPoint(m, { x: 5, y: 10 })).toEqual({ x: 10, y: 30 });
    });

    it('scales uniformly', () => {
      const m = scaleMatrix(createIdentity(), 0.5, 0.5);
      expect(applyToPoint(m, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
    });

    it('negative scale flips', () => {
      const m = scaleMatrix(createIdentity(), -1, -1);
      expect(applyToPoint(m, { x: 5, y: 10 })).toEqual({ x: -5, y: -10 });
    });
  });

  describe('rotateMatrix', () => {
    it('rotation by 0 does not change point', () => {
      const m = rotateMatrix(createIdentity(), 0);
      const result = applyToPoint(m, { x: 5, y: 0 });
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(0);
    });

    it('rotation by 90 degrees', () => {
      const m = rotateMatrix(createIdentity(), Math.PI / 2);
      const result = applyToPoint(m, { x: 1, y: 0 });
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(1);
    });

    it('rotation by 180 degrees', () => {
      const m = rotateMatrix(createIdentity(), Math.PI);
      const result = applyToPoint(m, { x: 1, y: 0 });
      expect(result.x).toBeCloseTo(-1);
      expect(result.y).toBeCloseTo(0);
    });

    it('full rotation returns to original', () => {
      const m = rotateMatrix(createIdentity(), Math.PI * 2);
      const result = applyToPoint(m, { x: 3, y: 4 });
      expect(result.x).toBeCloseTo(3);
      expect(result.y).toBeCloseTo(4);
    });
  });

  describe('applyToPoint', () => {
    it('applies identity to point', () => {
      expect(applyToPoint([1, 0, 0, 1, 0, 0], { x: 5, y: 10 })).toEqual({ x: 5, y: 10 });
    });

    it('applies pure translation', () => {
      expect(applyToPoint([1, 0, 0, 1, 10, 20], { x: 5, y: 5 })).toEqual({ x: 15, y: 25 });
    });

    it('applies combined scale and translate', () => {
      // scale(2,2) then translate(10,10): translate is applied through the scaled matrix
      // tx = a*10 + c*10 + mtx = 2*10 + 0 + 0 = 20, point: a*5 + c*5 + tx = 2*5 + 0 + 20 = 30
      const m = translate(scaleMatrix(createIdentity(), 2, 2), 10, 10);
      const result = applyToPoint(m, { x: 5, y: 5 });
      expect(result.x).toBeCloseTo(30);
      expect(result.y).toBeCloseTo(30);
    });
  });

  describe('inverse', () => {
    it('inverse of identity is identity', () => {
      const inv = inverse(createIdentity());
      expect(inv[0]).toBeCloseTo(1);
      expect(inv[1]).toBeCloseTo(0);
      expect(inv[2]).toBeCloseTo(0);
      expect(inv[3]).toBeCloseTo(1);
      expect(inv[4]).toBeCloseTo(0);
      expect(inv[5]).toBeCloseTo(0);
    });

    it('applying matrix then inverse returns original point', () => {
      const m = translate(scaleMatrix(createIdentity(), 2, 3), 10, 20);
      const inv = inverse(m);
      const p = { x: 7, y: 11 };
      const transformed = applyToPoint(m, p);
      const restored = applyToPoint(inv, transformed);
      expect(restored.x).toBeCloseTo(p.x);
      expect(restored.y).toBeCloseTo(p.y);
    });

    it('throws for singular matrix', () => {
      expect(() => inverse([0, 0, 0, 0, 0, 0])).toThrow('singular');
    });

    it('inverse of translation is negative translation', () => {
      const m = translate(createIdentity(), 10, 20);
      const inv = inverse(m);
      const result = applyToPoint(inv, { x: 10, y: 20 });
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });
  });

  describe('screenToCanvas', () => {
    it('converts with no offset and zoom=1', () => {
      const viewport = { scrollX: 0, scrollY: 0, zoom: 1 };
      expect(screenToCanvas({ x: 100, y: 200 }, viewport)).toEqual({ x: 100, y: 200 });
    });

    it('converts with scroll offset', () => {
      const viewport = { scrollX: 50, scrollY: 50, zoom: 1 };
      expect(screenToCanvas({ x: 100, y: 200 }, viewport)).toEqual({ x: 50, y: 150 });
    });

    it('converts with zoom', () => {
      const viewport = { scrollX: 0, scrollY: 0, zoom: 2 };
      expect(screenToCanvas({ x: 100, y: 200 }, viewport)).toEqual({ x: 50, y: 100 });
    });

    it('converts with both scroll and zoom', () => {
      const viewport = { scrollX: 100, scrollY: 100, zoom: 2 };
      const result = screenToCanvas({ x: 200, y: 300 }, viewport);
      expect(result.x).toBeCloseTo(50);
      expect(result.y).toBeCloseTo(100);
    });
  });

  describe('canvasToScreen', () => {
    it('converts with no offset and zoom=1', () => {
      const viewport = { scrollX: 0, scrollY: 0, zoom: 1 };
      expect(canvasToScreen({ x: 100, y: 200 }, viewport)).toEqual({ x: 100, y: 200 });
    });

    it('converts with scroll offset', () => {
      const viewport = { scrollX: 50, scrollY: 50, zoom: 1 };
      expect(canvasToScreen({ x: 100, y: 200 }, viewport)).toEqual({ x: 150, y: 250 });
    });

    it('converts with zoom', () => {
      const viewport = { scrollX: 0, scrollY: 0, zoom: 2 };
      expect(canvasToScreen({ x: 50, y: 100 }, viewport)).toEqual({ x: 100, y: 200 });
    });

    it('is inverse of screenToCanvas', () => {
      const viewport = { scrollX: 30, scrollY: 40, zoom: 1.5 };
      const screen = { x: 200, y: 300 };
      const canvas = screenToCanvas(screen, viewport);
      const restored = canvasToScreen(canvas, viewport);
      expect(restored.x).toBeCloseTo(screen.x);
      expect(restored.y).toBeCloseTo(screen.y);
    });
  });
});

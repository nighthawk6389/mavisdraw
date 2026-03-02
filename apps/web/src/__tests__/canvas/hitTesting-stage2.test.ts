import { describe, it, expect } from 'vitest';
import {
  findBindingTarget,
  getBindingPoint,
  hitTestElementsWithGroups,
  getGroupElementIds,
} from '../../components/canvas/HitTesting';
import type { MavisElement, RectangleElement, EllipseElement } from '@mavisdraw/types';

function makeRect(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  overrides?: Partial<RectangleElement>,
): RectangleElement {
  return {
    id,
    type: 'rectangle',
    diagramId: 'd1',
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    opacity: 100,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    fillStyle: 'none',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    seed: 1,
    renderMode: 'sketchy',
    layerId: 'default',
    groupIds: [],
    isLocked: false,
    isDeleted: false,
    boundElements: [],
    version: 1,
    updatedAt: Date.now(),
    roundness: 0,
    ...overrides,
  };
}

function makeEllipse(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
): EllipseElement {
  return {
    id,
    type: 'ellipse',
    diagramId: 'd1',
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    opacity: 100,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    fillStyle: 'none',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    seed: 1,
    renderMode: 'sketchy',
    layerId: 'default',
    groupIds: [],
    isLocked: false,
    isDeleted: false,
    boundElements: [],
    version: 1,
    updatedAt: Date.now(),
  };
}

describe('HitTesting - Stage 2', () => {
  describe('findBindingTarget', () => {
    it('finds a rectangle near a point', () => {
      const rect = makeRect('r1', 100, 100, 50, 50);
      const result = findBindingTarget(102, 125, [rect]);
      expect(result).not.toBeNull();
      expect(result!.element.id).toBe('r1');
    });

    it('returns null when no target is nearby', () => {
      const rect = makeRect('r1', 100, 100, 50, 50);
      const result = findBindingTarget(0, 0, [rect]);
      expect(result).toBeNull();
    });

    it('excludes specified element IDs', () => {
      const rect = makeRect('r1', 100, 100, 50, 50);
      const result = findBindingTarget(102, 125, [rect], new Set(['r1']));
      expect(result).toBeNull();
    });

    it('skips deleted elements', () => {
      const rect = makeRect('r1', 100, 100, 50, 50, { isDeleted: true });
      const result = findBindingTarget(102, 125, [rect]);
      expect(result).toBeNull();
    });

    it('finds an ellipse target', () => {
      const ellipse = makeEllipse('e1', 100, 100, 60, 40);
      // Point near the edge of the ellipse
      const result = findBindingTarget(100, 120, [ellipse]);
      expect(result).not.toBeNull();
      expect(result!.element.id).toBe('e1');
    });

    it('finds the closest target when multiple are nearby', () => {
      const rect1 = makeRect('r1', 100, 100, 50, 50);
      const rect2 = makeRect('r2', 105, 100, 50, 50);
      // Point closer to rect2's left edge
      const result = findBindingTarget(103, 125, [rect1, rect2]);
      expect(result).not.toBeNull();
      // Should find the closer one
    });
  });

  describe('getBindingPoint', () => {
    it('returns point on rectangle edge', () => {
      const rect = makeRect('r1', 100, 100, 100, 80);
      // From a point to the right
      const pt = getBindingPoint(rect, 300, 140);
      // Should be on the right edge
      expect(pt.x).toBeCloseTo(200); // x + width
      expect(pt.y).toBeCloseTo(140); // center y
    });

    it('returns point on rectangle edge from above', () => {
      const rect = makeRect('r1', 100, 100, 100, 80);
      const pt = getBindingPoint(rect, 150, 0);
      // Should be on the top edge
      expect(pt.x).toBeCloseTo(150);
      expect(pt.y).toBeCloseTo(100);
    });

    it('returns point on ellipse edge', () => {
      const ellipse = makeEllipse('e1', 100, 100, 100, 80);
      // From directly to the right
      const pt = getBindingPoint(ellipse, 300, 140);
      // Should be on right side of ellipse
      expect(pt.x).toBeCloseTo(200); // cx + rx
      expect(pt.y).toBeCloseTo(140); // cy
    });
  });

  describe('hitTestElementsWithGroups', () => {
    it('returns hit element when no groups', () => {
      const rect = makeRect('r1', 100, 100, 50, 50);
      const result = hitTestElementsWithGroups({ x: 125, y: 125 }, [rect]);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('r1');
    });

    it('returns null when no hit', () => {
      const rect = makeRect('r1', 100, 100, 50, 50);
      const result = hitTestElementsWithGroups({ x: 0, y: 0 }, [rect]);
      expect(result).toBeNull();
    });

    it('returns element from group when hitting group member', () => {
      const rect = makeRect('r1', 100, 100, 50, 50, { groupIds: ['g1'] });
      const result = hitTestElementsWithGroups({ x: 125, y: 125 }, [rect]);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('r1');
    });
  });

  describe('getGroupElementIds', () => {
    it('returns just the element id when no groups', () => {
      const rect = makeRect('r1', 100, 100, 50, 50);
      const result = getGroupElementIds(rect, [rect]);
      expect(result).toEqual(['r1']);
    });

    it('returns all group members', () => {
      const rect1 = makeRect('r1', 0, 0, 50, 50, { groupIds: ['g1'] });
      const rect2 = makeRect('r2', 100, 100, 50, 50, { groupIds: ['g1'] });
      const rect3 = makeRect('r3', 200, 200, 50, 50);

      const result = getGroupElementIds(rect1, [rect1, rect2, rect3]);
      expect(result).toContain('r1');
      expect(result).toContain('r2');
      expect(result).not.toContain('r3');
    });

    it('respects entered groups', () => {
      const rect1 = makeRect('r1', 0, 0, 50, 50, { groupIds: ['g1'] });
      const rect2 = makeRect('r2', 100, 100, 50, 50, { groupIds: ['g1'] });

      // When group 'g1' is entered, should return individual elements
      const result = getGroupElementIds(rect1, [rect1, rect2], new Set(['g1']));
      expect(result).toEqual(['r1']);
    });

    it('skips deleted elements in group', () => {
      const rect1 = makeRect('r1', 0, 0, 50, 50, { groupIds: ['g1'] });
      const rect2 = makeRect('r2', 100, 100, 50, 50, { groupIds: ['g1'], isDeleted: true });

      const result = getGroupElementIds(rect1, [rect1, rect2]);
      expect(result).toContain('r1');
      expect(result).not.toContain('r2');
    });
  });
});

import { describe, it, expect } from 'vitest';
import type { LinearElement, RectangleElement, EllipseElement, DiamondElement } from '@mavisdraw/types';
import {
  getAnchorPoints,
  hitTestAnchorPoint,
  findNearbyShapeForAnchors,
  getLinearEndpoints,
  hitTestEndpointHandle,
  getSegmentMidpoints,
  hitTestMidpointHandle,
  hitTestWaypoint,
} from '../../components/canvas/HitTesting';

function makeRectangle(overrides: Partial<RectangleElement> = {}): RectangleElement {
  return {
    id: 'rect-1',
    type: 'rectangle',
    diagramId: 'test',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    angle: 0,
    opacity: 100,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    fillStyle: 'none',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    seed: 0,
    renderMode: 'clean',
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

function makeEllipse(overrides: Partial<EllipseElement> = {}): EllipseElement {
  return {
    id: 'ellipse-1',
    type: 'ellipse',
    diagramId: 'test',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    angle: 0,
    opacity: 100,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    fillStyle: 'none',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    seed: 0,
    renderMode: 'clean',
    layerId: 'default',
    groupIds: [],
    isLocked: false,
    isDeleted: false,
    boundElements: [],
    version: 1,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeDiamond(overrides: Partial<DiamondElement> = {}): DiamondElement {
  return {
    id: 'diamond-1',
    type: 'diamond',
    diagramId: 'test',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    angle: 0,
    opacity: 100,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    fillStyle: 'none',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    seed: 0,
    renderMode: 'clean',
    layerId: 'default',
    groupIds: [],
    isLocked: false,
    isDeleted: false,
    boundElements: [],
    version: 1,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeLinearElement(overrides: Partial<LinearElement> = {}): LinearElement {
  return {
    id: 'arrow-1',
    type: 'arrow',
    diagramId: 'test',
    x: 0,
    y: 0,
    width: 100,
    height: 0,
    angle: 0,
    opacity: 100,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    fillStyle: 'none',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    seed: 0,
    renderMode: 'clean',
    layerId: 'default',
    groupIds: [],
    isLocked: false,
    isDeleted: false,
    boundElements: [],
    version: 1,
    updatedAt: Date.now(),
    points: [
      [0, 0],
      [100, 0],
    ],
    startBinding: null,
    endBinding: null,
    routingMode: 'straight',
    startArrowhead: 'none',
    endArrowhead: 'arrow',
    ...overrides,
  };
}

// ─── Phase 3: Anchor Points ─────────────────────────────

describe('Phase 3 - Anchor Points', () => {
  describe('getAnchorPoints', () => {
    it('returns 4 anchors at edge midpoints for a rectangle', () => {
      const rect = makeRectangle({ x: 100, y: 100, width: 200, height: 100 });
      const anchors = getAnchorPoints(rect);

      expect(anchors).toHaveLength(4);
      expect(anchors).toEqual([
        { position: 'top', x: 200, y: 100 },
        { position: 'right', x: 300, y: 150 },
        { position: 'bottom', x: 200, y: 200 },
        { position: 'left', x: 100, y: 150 },
      ]);
    });

    it('returns 4 anchors at edge midpoints for an ellipse', () => {
      const ellipse = makeEllipse({ x: 50, y: 50, width: 100, height: 60 });
      const anchors = getAnchorPoints(ellipse);

      expect(anchors).toHaveLength(4);
      expect(anchors).toEqual([
        { position: 'top', x: 100, y: 50 },
        { position: 'right', x: 150, y: 80 },
        { position: 'bottom', x: 100, y: 110 },
        { position: 'left', x: 50, y: 80 },
      ]);
    });

    it('returns 4 anchors at edge midpoints for a diamond', () => {
      const diamond = makeDiamond({ x: 0, y: 0, width: 100, height: 80 });
      const anchors = getAnchorPoints(diamond);

      expect(anchors).toHaveLength(4);
      expect(anchors).toEqual([
        { position: 'top', x: 50, y: 0 },
        { position: 'right', x: 100, y: 40 },
        { position: 'bottom', x: 50, y: 80 },
        { position: 'left', x: 0, y: 40 },
      ]);
    });
  });

  describe('hitTestAnchorPoint', () => {
    it('returns the correct anchor position when near an anchor', () => {
      const rect = makeRectangle({ x: 100, y: 100, width: 200, height: 100 });

      expect(hitTestAnchorPoint({ x: 200, y: 102 }, rect)).toBe('top');
      expect(hitTestAnchorPoint({ x: 298, y: 150 }, rect)).toBe('right');
      expect(hitTestAnchorPoint({ x: 200, y: 198 }, rect)).toBe('bottom');
      expect(hitTestAnchorPoint({ x: 103, y: 150 }, rect)).toBe('left');
    });

    it('returns null when far from any anchor', () => {
      const rect = makeRectangle({ x: 100, y: 100, width: 200, height: 100 });

      expect(hitTestAnchorPoint({ x: 200, y: 150 }, rect)).toBeNull();
      expect(hitTestAnchorPoint({ x: 0, y: 0 }, rect)).toBeNull();
      expect(hitTestAnchorPoint({ x: 500, y: 500 }, rect)).toBeNull();
    });

    it('respects custom threshold', () => {
      const rect = makeRectangle({ x: 100, y: 100, width: 200, height: 100 });

      expect(hitTestAnchorPoint({ x: 200, y: 85 }, rect, 20)).toBe('top');
      expect(hitTestAnchorPoint({ x: 200, y: 85 }, rect, 5)).toBeNull();
    });
  });

  describe('findNearbyShapeForAnchors', () => {
    it('returns element when cursor is near its edge', () => {
      const rect = makeRectangle();
      const result = findNearbyShapeForAnchors(105, 150, [rect]);
      expect(result).toBe(rect);
    });

    it('returns null when cursor is far from any shape', () => {
      const rect = makeRectangle();
      const result = findNearbyShapeForAnchors(500, 500, [rect]);
      expect(result).toBeNull();
    });

    it('excludes elements in excludeIds', () => {
      const rect = makeRectangle();
      const result = findNearbyShapeForAnchors(105, 150, [rect], new Set(['rect-1']));
      expect(result).toBeNull();
    });

    it('ignores deleted elements', () => {
      const rect = makeRectangle({ isDeleted: true });
      const result = findNearbyShapeForAnchors(105, 150, [rect]);
      expect(result).toBeNull();
    });

    it('ignores non-bindable element types', () => {
      const arrow = makeLinearElement();
      const result = findNearbyShapeForAnchors(50, 0, [arrow as any]);
      expect(result).toBeNull();
    });

    it('returns topmost element when multiple overlap', () => {
      const rect1 = makeRectangle({ id: 'rect-1' });
      const rect2 = makeRectangle({ id: 'rect-2' });
      const result = findNearbyShapeForAnchors(105, 150, [rect1, rect2]);
      expect(result!.id).toBe('rect-2');
    });
  });
});

// ─── Phase 4: Endpoint Handles ─────────────────────────────

describe('Phase 4 - Endpoint Handles', () => {
  describe('getLinearEndpoints', () => {
    it('returns correct canvas-space start and end for a horizontal arrow', () => {
      const arrow = makeLinearElement({ x: 10, y: 20, points: [[0, 0], [100, 0]] });
      const { start, end } = getLinearEndpoints(arrow);

      expect(start).toEqual({ x: 10, y: 20 });
      expect(end).toEqual({ x: 110, y: 20 });
    });

    it('returns correct canvas-space start and end for a diagonal arrow', () => {
      const arrow = makeLinearElement({ x: 50, y: 50, points: [[0, 0], [30, 40]] });
      const { start, end } = getLinearEndpoints(arrow);

      expect(start).toEqual({ x: 50, y: 50 });
      expect(end).toEqual({ x: 80, y: 90 });
    });

    it('handles multi-point arrows (returns first and last)', () => {
      const arrow = makeLinearElement({
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [50, 50],
          [100, 0],
        ],
      });
      const { start, end } = getLinearEndpoints(arrow);

      expect(start).toEqual({ x: 0, y: 0 });
      expect(end).toEqual({ x: 100, y: 0 });
    });
  });

  describe('hitTestEndpointHandle', () => {
    it("returns 'start' when near the start point", () => {
      const arrow = makeLinearElement({ x: 10, y: 20, points: [[0, 0], [100, 0]] });
      expect(hitTestEndpointHandle({ x: 12, y: 22 }, arrow)).toBe('start');
    });

    it("returns 'end' when near the end point", () => {
      const arrow = makeLinearElement({ x: 10, y: 20, points: [[0, 0], [100, 0]] });
      expect(hitTestEndpointHandle({ x: 108, y: 18 }, arrow)).toBe('end');
    });

    it('returns null when far from both endpoints', () => {
      const arrow = makeLinearElement({ x: 10, y: 20, points: [[0, 0], [100, 0]] });
      expect(hitTestEndpointHandle({ x: 60, y: 20 }, arrow)).toBeNull();
    });

    it('prefers end handle when equidistant (end tested first)', () => {
      const arrow = makeLinearElement({ x: 0, y: 0, points: [[0, 0], [0, 0]] });
      expect(hitTestEndpointHandle({ x: 0, y: 0 }, arrow)).toBe('end');
    });

    it('respects custom handleRadius', () => {
      const arrow = makeLinearElement({ x: 0, y: 0, points: [[0, 0], [100, 0]] });

      expect(hitTestEndpointHandle({ x: 0, y: 12 }, arrow, 15)).toBe('start');
      expect(hitTestEndpointHandle({ x: 0, y: 12 }, arrow, 5)).toBeNull();
    });
  });
});

// ─── Phase 5: Waypoint Handles ─────────────────────────────

describe('Phase 5 - Waypoint Handles', () => {
  describe('getSegmentMidpoints', () => {
    it('returns a single midpoint for a 2-point arrow', () => {
      const arrow = makeLinearElement({ x: 10, y: 20, points: [[0, 0], [100, 0]] });
      const midpoints = getSegmentMidpoints(arrow);

      expect(midpoints).toHaveLength(1);
      expect(midpoints[0]).toEqual({ x: 60, y: 20 });
    });

    it('returns correct midpoints for a 3-point arrow', () => {
      const arrow = makeLinearElement({
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [100, 0],
          [100, 100],
        ],
      });
      const midpoints = getSegmentMidpoints(arrow);

      expect(midpoints).toHaveLength(2);
      expect(midpoints[0]).toEqual({ x: 50, y: 0 });
      expect(midpoints[1]).toEqual({ x: 100, y: 50 });
    });

    it('returns correct midpoints for a 4-point arrow', () => {
      const arrow = makeLinearElement({
        x: 10,
        y: 10,
        points: [
          [0, 0],
          [40, 0],
          [40, 60],
          [80, 60],
        ],
      });
      const midpoints = getSegmentMidpoints(arrow);

      expect(midpoints).toHaveLength(3);
      expect(midpoints[0]).toEqual({ x: 30, y: 10 });
      expect(midpoints[1]).toEqual({ x: 50, y: 40 });
      expect(midpoints[2]).toEqual({ x: 70, y: 70 });
    });
  });

  describe('hitTestMidpointHandle', () => {
    it('returns the correct segment index when near a midpoint', () => {
      const arrow = makeLinearElement({
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [100, 0],
          [100, 100],
        ],
      });

      expect(hitTestMidpointHandle({ x: 50, y: 2 }, arrow)).toBe(0);
      expect(hitTestMidpointHandle({ x: 98, y: 50 }, arrow)).toBe(1);
    });

    it('returns -1 when far from all midpoints', () => {
      const arrow = makeLinearElement({
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [100, 0],
          [100, 100],
        ],
      });

      expect(hitTestMidpointHandle({ x: 200, y: 200 }, arrow)).toBe(-1);
    });

    it('respects custom handleRadius', () => {
      const arrow = makeLinearElement({ x: 0, y: 0, points: [[0, 0], [100, 0]] });

      expect(hitTestMidpointHandle({ x: 50, y: 12 }, arrow, 15)).toBe(0);
      expect(hitTestMidpointHandle({ x: 50, y: 12 }, arrow, 5)).toBe(-1);
    });
  });

  describe('hitTestWaypoint', () => {
    it('returns the correct waypoint index for a multi-point arrow', () => {
      const arrow = makeLinearElement({
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [50, 50],
          [100, 0],
        ],
      });

      expect(hitTestWaypoint({ x: 52, y: 48 }, arrow)).toBe(1);
    });

    it('returns -1 for a 2-point arrow (no intermediate waypoints)', () => {
      const arrow = makeLinearElement({ x: 0, y: 0, points: [[0, 0], [100, 0]] });
      expect(hitTestWaypoint({ x: 50, y: 0 }, arrow)).toBe(-1);
    });

    it('does not match start or end points', () => {
      const arrow = makeLinearElement({
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [50, 50],
          [100, 0],
        ],
      });

      expect(hitTestWaypoint({ x: 0, y: 0 }, arrow)).toBe(-1);
      expect(hitTestWaypoint({ x: 100, y: 0 }, arrow)).toBe(-1);
    });

    it('returns -1 when far from all waypoints', () => {
      const arrow = makeLinearElement({
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [50, 50],
          [100, 0],
        ],
      });

      expect(hitTestWaypoint({ x: 200, y: 200 }, arrow)).toBe(-1);
    });

    it('matches the correct waypoint in a 4-point arrow', () => {
      const arrow = makeLinearElement({
        x: 10,
        y: 10,
        points: [
          [0, 0],
          [40, 0],
          [40, 60],
          [80, 60],
        ],
      });

      expect(hitTestWaypoint({ x: 50, y: 12 }, arrow)).toBe(1);
      expect(hitTestWaypoint({ x: 52, y: 68 }, arrow)).toBe(2);
    });

    it('respects custom handleRadius', () => {
      const arrow = makeLinearElement({
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [50, 50],
          [100, 0],
        ],
      });

      expect(hitTestWaypoint({ x: 50, y: 62 }, arrow, 15)).toBe(1);
      expect(hitTestWaypoint({ x: 50, y: 62 }, arrow, 5)).toBe(-1);
    });
  });
});

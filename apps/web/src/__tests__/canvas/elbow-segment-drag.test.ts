import { describe, it, expect } from 'vitest';
import type { LinearElement, RectangleElement, MavisElement } from '@mavisdraw/types';
import { hitTestElbowSegment, computeElbowPoints } from '../../components/canvas/HitTesting';

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
    roughness: 1,
    seed: 1,
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

function makeElbowArrow(overrides: Partial<LinearElement> = {}): LinearElement {
  return {
    id: 'arrow-1',
    type: 'arrow',
    diagramId: 'test',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    opacity: 100,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    fillStyle: 'none',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    seed: 1,
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
      [200, 100],
    ],
    startBinding: null,
    endBinding: null,
    routingMode: 'elbow',
    startArrowhead: 'none',
    endArrowhead: 'arrow',
    ...overrides,
  };
}

describe('computeElbowPoints', () => {
  it('returns stored points when elbowManualRoute is true', () => {
    const manualPoints: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 80],
      [200, 80],
    ];
    const arrow = makeElbowArrow({
      points: manualPoints,
      elbowManualRoute: true,
    });

    const result = computeElbowPoints(arrow);
    expect(result).toEqual(manualPoints);
  });

  it('computes route dynamically when elbowManualRoute is false', () => {
    const arrow = makeElbowArrow({
      points: [
        [0, 0],
        [200, 100],
      ],
    });

    const result = computeElbowPoints(arrow);
    // Should have more than 2 points (the intermediate routing)
    expect(result.length).toBeGreaterThan(2);
    // First and last should match
    expect(result[0]).toEqual([0, 0]);
    expect(result[result.length - 1]).toEqual([200, 100]);
  });

  it('computes route with binding directions when elementsMap provided', () => {
    const rect = makeRectangle({ id: 'rect-1', x: 100, y: 100, width: 200, height: 100 });
    const arrow = makeElbowArrow({
      x: 200,
      y: 100,
      points: [
        [0, 0],
        [100, -200],
      ],
      startBinding: { elementId: 'rect-1', gap: 0 },
    });

    const map = new Map<string, MavisElement>();
    map.set(rect.id, rect);
    map.set(arrow.id, arrow);

    const result = computeElbowPoints(arrow, map);
    expect(result.length).toBeGreaterThan(2);
    // With top binding, should depart upward
    expect(result[1][1]).toBeLessThan(result[0][1]);
  });
});

describe('hitTestElbowSegment', () => {
  it('returns hit on inner segment of auto-routed elbow', () => {
    // Arrow from (50,50) with points [0,0] → [200,100]
    // Fallback heuristic (|dx|>|dy|): [0,0] → [100,0] → [100,100] → [200,100]
    // Inner segment is index 1: [100,0] → [100,100] (vertical)
    const arrow = makeElbowArrow({
      x: 50,
      y: 50,
      points: [
        [0, 0],
        [200, 100],
      ],
    });

    // Hit the vertical middle segment at canvas coords (150, 100)
    // In local coords that's [100, 50] which is on the vertical segment [100,0]→[100,100]
    const hit = hitTestElbowSegment({ x: 150, y: 100 }, arrow);
    expect(hit).not.toBeNull();
    expect(hit!.orientation).toBe('vertical');
  });

  it('returns null for miss', () => {
    const arrow = makeElbowArrow({
      x: 50,
      y: 50,
      points: [
        [0, 0],
        [200, 100],
      ],
    });

    const hit = hitTestElbowSegment({ x: 500, y: 500 }, arrow);
    expect(hit).toBeNull();
  });

  it('skips first and last segments', () => {
    // Auto-routed: [0,0] → [100,0] → [100,100] → [200,100]
    // First segment (index 0): [0,0]→[100,0] — should be skipped
    // Last segment (index 2): [100,100]→[200,100] — should be skipped
    const arrow = makeElbowArrow({
      x: 50,
      y: 50,
      points: [
        [0, 0],
        [200, 100],
      ],
    });

    // Hit the first segment midpoint at canvas (100, 50)
    const hitFirst = hitTestElbowSegment({ x: 100, y: 50 }, arrow);
    expect(hitFirst).toBeNull();

    // Hit the last segment midpoint at canvas (200, 150)
    const hitLast = hitTestElbowSegment({ x: 200, y: 150 }, arrow);
    expect(hitLast).toBeNull();
  });

  it('returns correct orientation for horizontal inner segment', () => {
    // Manually routed arrow with explicit points
    const arrow = makeElbowArrow({
      x: 0,
      y: 0,
      points: [
        [0, 0],
        [0, 50],
        [200, 50],
        [200, 100],
        [300, 100],
      ],
      elbowManualRoute: true,
    });

    // Hit the horizontal segment [0,50] → [200,50] at its midpoint (100, 50)
    // This is segment index 1, which is an inner segment
    const hit = hitTestElbowSegment({ x: 100, y: 50 }, arrow);
    expect(hit).not.toBeNull();
    expect(hit!.segmentIndex).toBe(1);
    expect(hit!.orientation).toBe('horizontal');
  });

  it('returns correct orientation for vertical inner segment', () => {
    const arrow = makeElbowArrow({
      x: 0,
      y: 0,
      points: [
        [0, 0],
        [0, 50],
        [200, 50],
        [200, 100],
        [300, 100],
      ],
      elbowManualRoute: true,
    });

    // Hit the vertical segment [200,50] → [200,100] at its midpoint (200, 75)
    // This is segment index 2, which is an inner segment
    const hit = hitTestElbowSegment({ x: 200, y: 75 }, arrow);
    expect(hit).not.toBeNull();
    expect(hit!.segmentIndex).toBe(2);
    expect(hit!.orientation).toBe('vertical');
  });

  it('returns null when arrow has fewer than 3 computed points', () => {
    // Nearly aligned — straight line
    const arrow = makeElbowArrow({
      x: 0,
      y: 0,
      points: [
        [0, 0],
        [2, 100],
      ],
    });

    const hit = hitTestElbowSegment({ x: 1, y: 50 }, arrow);
    expect(hit).toBeNull();
  });
});

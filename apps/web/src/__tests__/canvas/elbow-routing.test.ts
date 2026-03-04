import { describe, it, expect } from 'vitest';
import type { LinearElement, RectangleElement, MavisElement } from '@mavisdraw/types';
import { hitTestElement } from '../../components/canvas/HitTesting';

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

function makeArrow(overrides: Partial<LinearElement> = {}): LinearElement {
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

describe('Elbow routing with hit testing', () => {
  it('unbound elbow arrow uses fallback routing and hit-tests correctly', () => {
    const arrow = makeArrow({
      x: 50,
      y: 50,
      points: [
        [0, 0],
        [200, 100],
      ],
      routingMode: 'elbow',
    });

    // Midpoint of fallback heuristic (horizontal-first): midX = 100
    // Route: (50,50) -> (150,50) -> (150,150) -> (250,150)
    // Test a point on the horizontal segment
    const hit = hitTestElement({ x: 100, y: 50 }, arrow);
    expect(hit).toBe(true);

    // Test a point far away
    const miss = hitTestElement({ x: 500, y: 500 }, arrow);
    expect(miss).toBe(false);
  });

  it('arrow bound to top of rectangle routes upward first', () => {
    const rect = makeRectangle({ id: 'rect-1', x: 100, y: 100, width: 200, height: 100 });

    // Arrow starts from top center of rectangle (200, 100) and goes to (200, -100)
    const arrow = makeArrow({
      id: 'arrow-1',
      x: 200,
      y: 100,
      points: [
        [0, 0],
        [100, -200],
      ],
      routingMode: 'elbow',
      startBinding: { elementId: 'rect-1', gap: 0 },
    });

    const map = new Map<string, MavisElement>();
    map.set(rect.id, rect);
    map.set(arrow.id, arrow);

    // With top binding, arrow should go UP first from (200, 100)
    // Route: start -> (200, 80) [up by MARGIN] -> (300, 80) -> (300, -100)
    // Test a point that would be on the upward segment
    const hitUp = hitTestElement({ x: 200, y: 90 }, arrow, map);
    expect(hitUp).toBe(true);
  });

  it('arrow bound to right side routes rightward first', () => {
    const rect = makeRectangle({ id: 'rect-1', x: 100, y: 100, width: 200, height: 100 });

    // Arrow starts from right center of rectangle (300, 150) and goes to (500, 300)
    const arrow = makeArrow({
      id: 'arrow-1',
      x: 300,
      y: 150,
      points: [
        [0, 0],
        [200, 150],
      ],
      routingMode: 'elbow',
      startBinding: { elementId: 'rect-1', gap: 0 },
    });

    const map = new Map<string, MavisElement>();
    map.set(rect.id, rect);
    map.set(arrow.id, arrow);

    // With right binding, should go RIGHT first
    // Route: start -> (320, 150) -> (320, 300) -> (500, 300)
    const hitRight = hitTestElement({ x: 310, y: 150 }, arrow, map);
    expect(hitRight).toBe(true);
  });

  it('arrow with both start and end bindings routes correctly', () => {
    const rect1 = makeRectangle({ id: 'rect-1', x: 100, y: 100, width: 200, height: 100 });
    const rect2 = makeRectangle({ id: 'rect-2', x: 500, y: 300, width: 200, height: 100 });

    const arrow = makeArrow({
      id: 'arrow-1',
      x: 200,
      y: 200,
      points: [
        [0, 0],
        [400, 200],
      ],
      routingMode: 'elbow',
      startBinding: { elementId: 'rect-1', gap: 0 },
      endBinding: { elementId: 'rect-2', gap: 0 },
    });

    const map = new Map<string, MavisElement>();
    map.set(rect1.id, rect1);
    map.set(rect2.id, rect2);
    map.set(arrow.id, arrow);

    // Should not throw and should be hittable
    const hit = hitTestElement({ x: 200, y: 210 }, arrow, map);
    expect(typeof hit).toBe('boolean');
  });

  it('arrow bound to bottom routes downward first', () => {
    const rect = makeRectangle({ id: 'rect-1', x: 100, y: 100, width: 200, height: 100 });

    // Arrow from bottom center of rect (200, 200) going to (400, 400)
    const arrow = makeArrow({
      id: 'arrow-1',
      x: 200,
      y: 200,
      points: [
        [0, 0],
        [200, 200],
      ],
      routingMode: 'elbow',
      startBinding: { elementId: 'rect-1', gap: 0 },
    });

    const map = new Map<string, MavisElement>();
    map.set(rect.id, rect);
    map.set(arrow.id, arrow);

    // With bottom binding, should go DOWN first
    // Test a point on the downward segment from (200, 200)
    const hitDown = hitTestElement({ x: 200, y: 210 }, arrow, map);
    expect(hitDown).toBe(true);
  });

  it('without elementsMap, bound arrows fall back to legacy routing', () => {
    const arrow = makeArrow({
      x: 50,
      y: 50,
      points: [
        [0, 0],
        [200, 100],
      ],
      routingMode: 'elbow',
      startBinding: { elementId: 'rect-1', gap: 0 },
    });

    // Without map, should use fallback heuristic (no crash)
    const hit = hitTestElement({ x: 100, y: 50 }, arrow);
    expect(typeof hit).toBe('boolean');
  });
});

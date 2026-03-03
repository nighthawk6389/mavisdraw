import { describe, it, expect } from 'vitest';
import { hitTestElement } from '../components/canvas/HitTesting';
import type { LinearElement } from '@mavisdraw/types';

function makeLinearElement(overrides: Partial<LinearElement> = {}): LinearElement {
  return {
    id: 'test-arrow',
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
    points: [[0, 0], [100, 0]],
    startBinding: null,
    endBinding: null,
    routingMode: 'straight',
    startArrowhead: 'none',
    endArrowhead: 'arrow',
    ...overrides,
  };
}

describe('hitTestElement for linear elements', () => {
  it('hits a straight arrow on the line', () => {
    const arrow = makeLinearElement();
    expect(hitTestElement({ x: 50, y: 0 }, arrow)).toBe(true);
  });

  it('misses a straight arrow far from the line', () => {
    const arrow = makeLinearElement();
    expect(hitTestElement({ x: 50, y: 30 }, arrow)).toBe(false);
  });

  it('hits a curved arrow on the curve', () => {
    const arrow = makeLinearElement({
      routingMode: 'curved',
      points: [[0, 0], [100, 0]],
    });
    expect(hitTestElement({ x: 50, y: 15 }, arrow)).toBe(true);
  });

  it('misses a curved arrow on the straight line between endpoints', () => {
    const arrow = makeLinearElement({
      routingMode: 'curved',
      points: [[0, 0], [200, 0]],
    });
    expect(hitTestElement({ x: 100, y: 50 }, arrow)).toBe(false);
  });

  it('hits an elbow arrow on the elbow path', () => {
    const arrow = makeLinearElement({
      routingMode: 'elbow',
      points: [[0, 0], [100, 100]],
      width: 100,
      height: 100,
    });
    expect(hitTestElement({ x: 50, y: 50 }, arrow)).toBe(true);
  });

  it('misses an elbow arrow far from path', () => {
    const arrow = makeLinearElement({
      routingMode: 'elbow',
      points: [[0, 0], [100, 100]],
      width: 100,
      height: 100,
    });
    expect(hitTestElement({ x: 80, y: 20 }, arrow)).toBe(false);
  });

  it('hits elbow arrow on aligned endpoints (straight line)', () => {
    const arrow = makeLinearElement({
      routingMode: 'elbow',
      points: [[0, 0], [0, 100]],
      width: 0,
      height: 100,
    });
    expect(hitTestElement({ x: 0, y: 50 }, arrow)).toBe(true);
  });
});

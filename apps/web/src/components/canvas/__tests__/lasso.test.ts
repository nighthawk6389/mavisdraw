import { describe, it, expect } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import { hitTestLasso, pointInPolygon } from '../HitTesting';

const el = (id: string, x: number, y: number, extra: Partial<MavisElement> = {}) =>
  ({
    id,
    type: 'rectangle',
    x,
    y,
    width: 50,
    height: 50,
    angle: 0,
    isDeleted: false,
    boundElements: [],
    ...extra,
  }) as unknown as MavisElement;

/** An L-shaped loop: around (0..100, 0..300) and (0..300, 200..300). */
const L = [
  { x: -10, y: -10 },
  { x: 110, y: -10 },
  { x: 110, y: 190 },
  { x: 310, y: 190 },
  { x: 310, y: 310 },
  { x: -10, y: 310 },
];

describe('lasso selection', () => {
  it('knows inside from outside, concave loops included', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, L)).toBe(true);
    expect(pointInPolygon({ x: 250, y: 250 }, L)).toBe(true);
    // In the L's notch: inside its bounding box, outside the loop
    expect(pointInPolygon({ x: 250, y: 50 }, L)).toBe(false);
  });

  it('picks what the loop encloses entirely, not what a box around it would', () => {
    const picked = hitTestLasso(L, [
      el('top', 20, 20),
      el('corner', 230, 230),
      el('notch', 200, 40),
      el('straddling', 80, 100, { width: 80 } as Partial<MavisElement>),
    ]);
    expect(picked.map((e) => e.id)).toEqual(['top', 'corner']);
  });

  it('takes a line by its points and leaves labels to their shapes', () => {
    const line = el('line', 10, 10, {
      type: 'line',
      points: [
        [0, 0],
        [60, 250],
      ],
    } as Partial<MavisElement>);
    const label = el('label', 20, 20, {
      type: 'text',
      containerId: 'top',
    } as Partial<MavisElement>);
    expect(hitTestLasso(L, [line, label]).map((e) => e.id)).toEqual(['line']);
    expect(
      hitTestLasso(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        [line],
      ),
    ).toEqual([]);
  });
});

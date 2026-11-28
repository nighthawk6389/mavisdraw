import { describe, it, expect } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import { hitTestEraser } from '../HitTesting';

/** What the eraser touches as it passes: outlines and strokes, insides only when filled. */
const shape = (type: string, extra: Partial<MavisElement> = {}) =>
  ({
    id: type,
    type,
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    angle: 0,
    strokeWidth: 2,
    backgroundColor: 'transparent',
    isDeleted: false,
    boundElements: [],
    ...extra,
  }) as unknown as MavisElement;

describe('the eraser', () => {
  it('erases an empty shape at its outline, not when brushed through its middle', () => {
    for (const type of ['rectangle', 'ellipse', 'diamond']) {
      const el = shape(type);
      expect(hitTestEraser({ x: 100, y: 50 }, el, undefined, 6), type).toBe(false);
      // On the outline (left edge for the box, left tip for the ellipse and diamond)
      expect(hitTestEraser({ x: 1, y: 50 }, el, undefined, 6), type).toBe(true);
      // Well outside
      expect(hitTestEraser({ x: -40, y: 50 }, el, undefined, 6), type).toBe(false);
    }
  });

  it('erases a filled shape, a picture or a card anywhere on it', () => {
    expect(
      hitTestEraser(
        { x: 100, y: 50 },
        shape('rectangle', { backgroundColor: '#ffc9c9' }),
        undefined,
        6,
      ),
    ).toBe(true);
    expect(hitTestEraser({ x: 100, y: 50 }, shape('image'), undefined, 6)).toBe(true);
    expect(hitTestEraser({ x: 100, y: 50 }, shape('portal'), undefined, 6)).toBe(true);
  });

  it('erases a line where the trail crosses it, with the eraser’s reach', () => {
    const line = shape('freedraw', {
      points: [
        [0, 0],
        [200, 0],
      ],
      height: 0,
    } as Partial<MavisElement>);
    expect(hitTestEraser({ x: 100, y: 10 }, line, undefined, 6)).toBe(true);
    expect(hitTestEraser({ x: 100, y: 10 }, line, undefined, 0)).toBe(false);
    expect(hitTestEraser({ x: 100, y: 40 }, line, undefined, 6)).toBe(false);
  });

  it('follows a rotated shape’s outline', () => {
    const turned = shape('rectangle', { angle: Math.PI / 2 });
    // Turned a quarter around its centre (100, 50): its long sides are now vertical, at x = 50 and 150
    expect(hitTestEraser({ x: 50, y: 50 }, turned, undefined, 6)).toBe(true);
    expect(hitTestEraser({ x: 100, y: 50 }, turned, undefined, 6)).toBe(false);
  });
});

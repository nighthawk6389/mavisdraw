import { describe, it, expect } from 'vitest';
import { minimapLayout, minimapToCanvas, visibleBounds } from '../minimapLayout';

describe('the overview map', () => {
  const size = { width: 200, height: 100 };

  it('fits the content and the view together, centred, with a margin', () => {
    const layout = minimapLayout(
      { x: 0, y: 0, width: 1000, height: 200 },
      { x: 0, y: 0, width: 400, height: 300 },
      size,
    );
    // World is 1000 × 300 in a 200 × 100 map: the width limits the scale
    expect(layout.scale).toBeCloseTo((200 * 0.84) / 1000);
    // Back and forth: a minimap point maps to the canvas point under it
    const p = minimapToCanvas(layout, layout.offsetX + 50 * layout.scale, layout.offsetY);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(0);
  });

  it('shows just the view when the diagram is empty', () => {
    const layout = minimapLayout(null, { x: -100, y: -50, width: 400, height: 200 }, size);
    const centre = minimapToCanvas(layout, 100, 50);
    expect(centre.x).toBeCloseTo(100);
    expect(centre.y).toBeCloseTo(50);
  });

  it('knows what part of the canvas is on screen', () => {
    expect(
      visibleBounds({ zoom: 2, scrollX: -200, scrollY: 100 }, { width: 800, height: 600 }),
    ).toEqual({
      x: 100,
      y: -50,
      width: 400,
      height: 300,
    });
  });
});

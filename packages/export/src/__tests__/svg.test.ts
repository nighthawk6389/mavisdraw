import { describe, it, expect } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import { exportToSvg } from '../svg';
import { renderSvgMarkup } from '../svgMarkup';

const base = {
  diagramId: 'd',
  angle: 0,
  opacity: 100,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'none',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 1,
  seed: 7,
  renderMode: 'clean',
  layerId: 'default',
  groupIds: [],
  isLocked: false,
  isDeleted: false,
  boundElements: [],
  version: 1,
  updatedAt: 1,
};
const el = (extra: Record<string, unknown>) => ({ ...base, ...extra }) as unknown as MavisElement;

const options = (renderMode: 'clean' | 'sketchy') =>
  ({
    format: 'svg',
    includeBackground: true,
    scale: 1,
    includeNestedDiagrams: false,
    renderMode,
    padding: 20,
  }) as const;

describe('exporting SVG from the editor', () => {
  it('writes nothing a teammate could use to put markup or script in the file', () => {
    const hostile = [
      el({
        id: 'r',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        roundness: 0,
        strokeColor: '"><script>alert(1)</script><rect stroke="',
        backgroundColor: 'red" onload="alert(2)',
        fillStyle: 'solid',
      }),
      el({
        id: 't',
        type: 'text',
        x: 0,
        y: 80,
        width: 200,
        height: 30,
        text: '</text><script>alert(3)</script>',
        fontSize: 20,
        fontFamily: '"><script>',
        textAlign: 'left',
        verticalAlign: 'top',
        lineHeight: 1.25,
        containerId: null,
      }),
    ];
    for (const mode of ['clean', 'sketchy'] as const) {
      const svg = exportToSvg(hostile, options(mode), '#ffffff');
      expect(svg).not.toMatch(/<script/i);
      expect(svg).not.toMatch(/onload=/i);
      expect(svg).toContain('&lt;/text&gt;&lt;script&gt;');
      // Still a well-formed document
      expect(
        new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror'),
      ).toBeNull();
    }
  });

  it('draws text once in hand-drawn mode, and the background only when asked', () => {
    const label = el({
      id: 't',
      type: 'text',
      x: 0,
      y: 0,
      width: 200,
      height: 30,
      text: 'Checkout',
      fontSize: 20,
      fontFamily: 'hand-drawn',
      textAlign: 'left',
      verticalAlign: 'top',
      lineHeight: 1.25,
      containerId: null,
    });
    const sketchy = exportToSvg([label], options('sketchy'), '#ffffff');
    expect(sketchy.match(/Checkout/g)).toHaveLength(1);
    expect(sketchy).toContain('fill="#ffffff"');
    const transparent = exportToSvg([label], { ...options('clean'), includeBackground: false });
    expect(transparent).not.toContain('fill="#ffffff"');
  });

  it('draws the rest of the map when one stored element is malformed', () => {
    const broken = [
      { id: 'a', type: 'arrow', x: 0, y: 0, width: 10, height: 10, points: undefined },
      { id: 'b', type: 'rectangle', x: 0, y: 0, width: 50, height: 30, boundElements: 'x' },
      { id: 'c', type: 'freedraw', x: 0, y: 0, width: 5, height: 5, points: [[0, 0], null] },
    ] as unknown as Parameters<typeof renderSvgMarkup>[0];
    const svg = renderSvgMarkup(broken);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<rect');
  });
});

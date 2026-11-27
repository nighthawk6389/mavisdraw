import { describe, it, expect } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import { renderSvgMarkup, safeColor, escapeXml, num } from '../svgMarkup';

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

const rect = el({ id: 'r', type: 'rectangle', x: 0, y: 0, width: 120, height: 60, roundness: 8 });
const label = el({
  id: 't',
  type: 'text',
  x: 10,
  y: 20,
  width: 100,
  height: 20,
  text: 'Orders <API> & "co"',
  fontSize: 16,
  fontFamily: 'hand-drawn',
  textAlign: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.25,
  containerId: 'r',
});
const portal = el({
  id: 'p',
  type: 'portal',
  x: 200,
  y: 0,
  width: 160,
  height: 90,
  label: 'Payments',
  targetDiagramId: 'child-1',
  thumbnailDataUrl: null,
  portalStyle: 'card',
  githubLink: null,
});
const arrow = el({
  id: 'a',
  type: 'arrow',
  x: 120,
  y: 30,
  width: 80,
  height: 0,
  points: [
    [0, 0],
    [80, 0],
  ],
  startBinding: null,
  endBinding: null,
  routingMode: 'straight',
  startArrowhead: 'none',
  endArrowhead: 'arrow',
});

describe('renderSvgMarkup', () => {
  it('draws shapes, labels, arrows and portals in a standalone SVG', () => {
    const svg = renderSvgMarkup([rect, label, portal, arrow]);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-24 -24')).toBe(true);
    expect(svg).toContain('<rect width="120" height="60" rx="8"');
    expect(svg).toContain('Orders &lt;API&gt; &amp; &quot;co&quot;');
    expect(svg).toContain('>Payments</text>');
    expect(svg).toContain('<polygon points="80,0'); // arrowhead at the tip
    expect(svg).toContain(`font-family="'Architects Daughter', 'Segoe Print'`);
  });

  it('centres connector labels on the route, on a backdrop the line does not cross', () => {
    const onArrow = { ...arrow, boundElements: [{ id: 'al', type: 'text' }] } as MavisElement;
    const arrowLabel = el({
      ...label,
      id: 'al',
      text: 'HTTPS',
      fontFamily: 'sans-serif',
      containerId: 'a',
      x: 999, // stale position: the route decides
      y: 999,
    });
    const svg = renderSvgMarkup([onArrow, arrowLabel], { theme: 'dark' });
    // Middle of 120→200 at y=30
    expect(svg).toMatch(
      /<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" rx="4" fill="#0d1117" \/><text[^>]*text-anchor="middle"><tspan x="160"/,
    );
    expect(svg).toContain('>HTTPS</tspan>');
    expect(svg).not.toContain('translate(999');
  });

  it('puts labels right above their container, whatever the array order', () => {
    const svg = renderSvgMarkup([label, el({ ...rect, zIndex: 5 }), el({ ...portal, zIndex: 1 })]);
    const at = (s: string) => svg.indexOf(s);
    expect(at('>Payments<')).toBeLessThan(at('<rect width="120"'));
    expect(at('<rect width="120"')).toBeLessThan(at('Orders'));
  });

  it('leaves deleted elements out', () => {
    expect(renderSvgMarkup([el({ ...rect, isDeleted: true })])).not.toContain('<rect width="120"');
  });

  it('can mark portals so a viewer can make them clickable', () => {
    const svg = renderSvgMarkup([portal], { portalHooks: true });
    expect(svg).toContain('data-portal="child-1"');
    expect(svg).toContain('data-label="Payments"');
    expect(renderSvgMarkup([portal])).not.toContain('data-portal');
  });

  it('draws the hand-drawn style without a DOM', () => {
    const svg = renderSvgMarkup([rect], { renderMode: 'sketchy' });
    expect(svg).not.toContain('<rect width="120"');
    expect(svg).toMatch(/<path d="M[\d.-]+ [\d.-]+ C/);
  });

  it('recolors default ink for dark pages, keeping chosen colors', () => {
    const red = el({ ...rect, id: 'red', strokeColor: '#e03131' });
    const svg = renderSvgMarkup([rect, red], { theme: 'dark' });
    expect(svg).toContain('fill="#0d1117"');
    expect(svg).toContain('stroke="#e6edf3"');
    expect(svg).toContain('stroke="#e03131"');
  });

  it('scales the drawing down to a maximum width', () => {
    const svg = renderSvgMarkup([rect, portal], { maxWidth: 200 });
    expect(svg).toMatch(/width="200" height="[\d.]+"/);
  });
});

describe('untrusted diagram data', () => {
  it('cannot break out of attributes or inject markup', () => {
    const evil = el({
      ...rect,
      strokeColor: '#000" onload="alert(1)',
      backgroundColor: 'red"/><script>alert(1)</script>',
      fillStyle: 'solid',
      strokeWidth: '2" onclick="x' as unknown as number,
      x: 'javascript:alert(1)' as unknown as number,
    });
    const text = el({
      ...label,
      text: '</text><script>alert(1)</script>',
      fontFamily: '"><script>',
    });
    const pic = el({
      id: 'i',
      type: 'image',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      imageUrl: 'https://evil.example/track.png',
    });
    const svg = renderSvgMarkup([evil, text, pic]);
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/\son\w+=/i);
    expect(svg).not.toContain('javascript:');
    expect(svg).not.toContain('evil.example');
  });

  it('only keeps inline image data', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const pic = el({ id: 'i', type: 'image', x: 0, y: 0, width: 10, height: 10, imageUrl: png });
    expect(renderSvgMarkup([pic])).toContain(`href="${png}"`);
  });

  it('accepts real colors and rejects everything else', () => {
    expect(safeColor('#a1b2c3', 'x')).toBe('#a1b2c3');
    expect(safeColor('rgba(0, 0, 0, 0.5)', 'x')).toBe('rgba(0, 0, 0, 0.5)');
    expect(safeColor('transparent', 'x')).toBe('transparent');
    expect(safeColor('url(#a)', 'x')).toBe('x');
    expect(safeColor('red;stroke:blue', 'x')).toBe('x');
    expect(safeColor(42, 'x')).toBe('x');
  });

  it('turns anything that is not a finite number into 0', () => {
    expect(num('12.345')).toBe(12.35);
    expect(num(NaN)).toBe(0);
    expect(num('1" onload="x')).toBe(0);
    expect(num(1e12)).toBe(1e7);
  });

  it('escapes quotes as well as tags', () => {
    expect(escapeXml(`<a href='x'>"&"</a>`)).toBe(
      '&lt;a href=&#39;x&#39;&gt;&quot;&amp;&quot;&lt;/a&gt;',
    );
  });
});

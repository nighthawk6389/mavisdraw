import type {
  MavisElement,
  RenderMode,
  SvgExportOptions,
  LinearElement,
  TextElement,
  RectangleElement,
  PortalElement,
} from '@mavisdraw/types';
import { computeElementsBounds } from './utils/bounds';

// ---------------------------------------------------------------------------
// Rough.js options builder (mirrors CanvasRenderer.buildRoughOptions)
// ---------------------------------------------------------------------------

function buildRoughOptions(element: MavisElement): Record<string, unknown> {
  const options: Record<string, unknown> = {
    stroke: element.strokeColor,
    strokeWidth: element.strokeWidth,
    roughness: element.roughness,
    seed: element.seed,
  };

  if (element.backgroundColor !== 'transparent' && element.fillStyle !== 'none') {
    options.fill = element.backgroundColor;
    options.fillStyle = element.fillStyle;
  }

  if (element.strokeStyle === 'dashed') {
    options.strokeLineDash = [8, 4];
  } else if (element.strokeStyle === 'dotted') {
    options.strokeLineDash = [2, 4];
  }

  return options;
}

// ---------------------------------------------------------------------------
// SVG style helpers
// ---------------------------------------------------------------------------

function svgStrokeStyle(element: MavisElement): string {
  const parts: string[] = [
    `stroke="${element.strokeColor}"`,
    `stroke-width="${element.strokeWidth}"`,
  ];

  if (element.strokeStyle === 'dashed') {
    parts.push('stroke-dasharray="8 4"');
  } else if (element.strokeStyle === 'dotted') {
    parts.push('stroke-dasharray="2 4"');
  }

  return parts.join(' ');
}

function svgFill(element: MavisElement): string {
  if (element.fillStyle === 'none' || element.backgroundColor === 'transparent') {
    return 'fill="none"';
  }
  return `fill="${element.backgroundColor}"`;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function elementTransform(element: MavisElement): string {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const angleDeg = radToDeg(element.angle);
  if (angleDeg === 0) {
    return `translate(${element.x}, ${element.y})`;
  }
  return (
    `translate(${cx}, ${cy}) ` +
    `rotate(${angleDeg}) ` +
    `translate(${-element.width / 2}, ${-element.height / 2})`
  );
}

// ---------------------------------------------------------------------------
// Clean mode: native SVG element generators
// ---------------------------------------------------------------------------

function renderRectangleClean(el: MavisElement): string {
  const rect = el as RectangleElement;
  const rx = rect.roundness > 0 ? ` rx="${rect.roundness}"` : '';
  return `<rect width="${el.width}" height="${el.height}"${rx} ${svgFill(el)} ${svgStrokeStyle(el)} />`;
}

function renderEllipseClean(el: MavisElement): string {
  const cx = el.width / 2;
  const cy = el.height / 2;
  return `<ellipse cx="${cx}" cy="${cy}" rx="${cx}" ry="${cy}" ${svgFill(el)} ${svgStrokeStyle(el)} />`;
}

function renderDiamondClean(el: MavisElement): string {
  const w = el.width;
  const h = el.height;
  const points = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;
  return `<polygon points="${points}" ${svgFill(el)} ${svgStrokeStyle(el)} />`;
}

function renderTriangleClean(el: MavisElement): string {
  const w = el.width;
  const h = el.height;
  const points = `${w / 2},0 ${w},${h} 0,${h}`;
  return `<polygon points="${points}" ${svgFill(el)} ${svgStrokeStyle(el)} />`;
}

function renderLinearClean(el: MavisElement): string {
  const linear = el as LinearElement;
  if (linear.points.length < 2) return '';

  const parts: string[] = [];

  // Build path
  const [startX, startY] = linear.points[0];
  let d = `M ${startX} ${startY}`;

  if (linear.routingMode === 'curved' && linear.points.length === 2) {
    // Simple curved line between 2 points — use quadratic bezier
    const [endX, endY] = linear.points[1];
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const curvature = dist * 0.2;
    const nx = -dy / dist;
    const ny = dx / dist;
    const cpx = midX + nx * curvature;
    const cpy = midY + ny * curvature;
    d += ` Q ${cpx} ${cpy} ${endX} ${endY}`;
  } else {
    for (let i = 1; i < linear.points.length; i++) {
      d += ` L ${linear.points[i][0]} ${linear.points[i][1]}`;
    }
  }

  parts.push(`<path d="${d}" fill="none" ${svgStrokeStyle(el)} />`);

  // Arrowheads
  if (linear.type === 'arrow') {
    if (linear.endArrowhead !== 'none') {
      parts.push(renderArrowheadSvg(linear, 'end'));
    }
    if (linear.startArrowhead !== 'none') {
      parts.push(renderArrowheadSvg(linear, 'start'));
    }
  }

  return parts.join('\n');
}

function renderArrowheadSvg(
  linear: LinearElement,
  end: 'start' | 'end',
): string {
  const points = linear.points;
  if (points.length < 2) return '';

  let tipX: number, tipY: number, fromX: number, fromY: number;
  if (end === 'end') {
    [tipX, tipY] = points[points.length - 1];
    [fromX, fromY] = points[points.length - 2];
  } else {
    [tipX, tipY] = points[0];
    [fromX, fromY] = points[1];
  }

  const dx = tipX - fromX;
  const dy = tipY - fromY;
  const angle = Math.atan2(dy, dx);
  const headLen = Math.max(linear.strokeWidth * 3, 10);

  const arrowhead = end === 'end' ? linear.endArrowhead : linear.startArrowhead;

  if (arrowhead === 'arrow' || arrowhead === 'triangle') {
    const x1 = tipX - headLen * Math.cos(angle - Math.PI / 6);
    const y1 = tipY - headLen * Math.sin(angle - Math.PI / 6);
    const x2 = tipX - headLen * Math.cos(angle + Math.PI / 6);
    const y2 = tipY - headLen * Math.sin(angle + Math.PI / 6);
    const fill = arrowhead === 'triangle' ? linear.strokeColor : 'none';
    return `<polygon points="${tipX},${tipY} ${x1},${y1} ${x2},${y2}" fill="${fill}" stroke="${linear.strokeColor}" stroke-width="${linear.strokeWidth}" />`;
  }

  if (arrowhead === 'dot') {
    const r = headLen / 2;
    return `<circle cx="${tipX}" cy="${tipY}" r="${r}" fill="${linear.strokeColor}" />`;
  }

  if (arrowhead === 'bar') {
    const perpAngle = angle + Math.PI / 2;
    const x1 = tipX + headLen * 0.5 * Math.cos(perpAngle);
    const y1 = tipY + headLen * 0.5 * Math.sin(perpAngle);
    const x2 = tipX - headLen * 0.5 * Math.cos(perpAngle);
    const y2 = tipY - headLen * 0.5 * Math.sin(perpAngle);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${linear.strokeColor}" stroke-width="${linear.strokeWidth}" />`;
  }

  return '';
}

function renderFreedrawClean(el: MavisElement): string {
  const linear = el as LinearElement;
  if (linear.points.length < 2) return '';
  const [startX, startY] = linear.points[0];
  let d = `M ${startX} ${startY}`;
  for (let i = 1; i < linear.points.length; i++) {
    d += ` L ${linear.points[i][0]} ${linear.points[i][1]}`;
  }
  return `<path d="${d}" fill="none" ${svgStrokeStyle(el)} stroke-linecap="round" stroke-linejoin="round" />`;
}

function fontFamilyCss(family: string): string {
  switch (family) {
    case 'hand-drawn':
      return 'Virgil, cursive';
    case 'monospace':
      return 'Cascadia Code, monospace';
    default:
      return 'Helvetica, Arial, sans-serif';
  }
}

function renderTextClean(el: MavisElement): string {
  const text = el as TextElement;
  const lines = text.text.split('\n');
  const lineHeight = text.fontSize * (text.lineHeight || 1.25);

  let textAnchor = 'start';
  let xOffset = 0;
  if (text.textAlign === 'center') {
    textAnchor = 'middle';
    xOffset = el.width / 2;
  } else if (text.textAlign === 'right') {
    textAnchor = 'end';
    xOffset = el.width;
  }

  let yStart = text.fontSize; // baseline offset
  if (text.verticalAlign === 'middle') {
    const totalHeight = lines.length * lineHeight;
    yStart = (el.height - totalHeight) / 2 + text.fontSize;
  } else if (text.verticalAlign === 'bottom') {
    const totalHeight = lines.length * lineHeight;
    yStart = el.height - totalHeight + text.fontSize;
  }

  const tspans = lines
    .map((line, i) => {
      const y = yStart + i * lineHeight;
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<tspan x="${xOffset}" y="${y}">${escaped}</tspan>`;
    })
    .join('');

  return (
    `<text font-family="${fontFamilyCss(text.fontFamily)}" font-size="${text.fontSize}" ` +
    `fill="${el.strokeColor}" text-anchor="${textAnchor}">${tspans}</text>`
  );
}

function renderPortalClean(el: MavisElement): string {
  const portal = el as PortalElement;
  const parts: string[] = [];
  parts.push(
    `<rect width="${el.width}" height="${el.height}" rx="8" ` +
      `fill="${el.backgroundColor === 'transparent' ? '#f0f4ff' : el.backgroundColor}" ` +
      `${svgStrokeStyle(el)} stroke-dasharray="6 3" />`,
  );
  if (portal.label) {
    const escaped = portal.label
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    parts.push(
      `<text x="${el.width / 2}" y="${el.height / 2}" ` +
        `text-anchor="middle" dominant-baseline="central" ` +
        `font-family="Helvetica, sans-serif" font-size="14" fill="#4a5568">${escaped}</text>`,
    );
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Sketchy mode: use rough.js SVG generator
// ---------------------------------------------------------------------------

function renderElementSketchy(
  svgElement: SVGSVGElement,
  el: MavisElement,
  roughSVG: unknown,
): SVGGElement | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rs = roughSVG as any;
  const opts = buildRoughOptions(el);
  let node: SVGElement | null = null;

  switch (el.type) {
    case 'rectangle': {
      const rect = el as RectangleElement;
      if (rect.roundness > 0) {
        // Rough.js doesn't support roundness directly — approximate with a path
        node = rs.rectangle(0, 0, el.width, el.height, opts);
      } else {
        node = rs.rectangle(0, 0, el.width, el.height, opts);
      }
      break;
    }
    case 'ellipse':
      node = rs.ellipse(el.width / 2, el.height / 2, el.width, el.height, opts);
      break;
    case 'diamond': {
      const w = el.width;
      const h = el.height;
      node = rs.polygon(
        [
          [w / 2, 0],
          [w, h / 2],
          [w / 2, h],
          [0, h / 2],
        ],
        opts,
      );
      break;
    }
    case 'triangle': {
      const w = el.width;
      const h = el.height;
      node = rs.polygon(
        [
          [w / 2, 0],
          [w, h],
          [0, h],
        ],
        opts,
      );
      break;
    }
    case 'line':
    case 'arrow': {
      const linear = el as LinearElement;
      if (linear.points.length >= 2) {
        node = rs.linearPath(
          linear.points.map(([x, y]) => [x, y]),
          opts,
        );
      }
      break;
    }
    case 'freedraw': {
      const linear = el as LinearElement;
      if (linear.points.length >= 2) {
        node = rs.linearPath(
          linear.points.map(([x, y]) => [x, y]),
          { ...opts, roughness: 0 },
        );
      }
      break;
    }
    default:
      return null;
  }

  if (!node) return null;

  const g = svgElement.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.appendChild(node);

  // Add arrowheads for arrows (rough.js doesn't handle arrowheads)
  if (el.type === 'arrow') {
    const linear = el as LinearElement;
    if (linear.endArrowhead !== 'none') {
      const arrowSvg = renderArrowheadSvg(linear, 'end');
      if (arrowSvg) {
        g.insertAdjacentHTML('beforeend', arrowSvg);
      }
    }
    if (linear.startArrowhead !== 'none') {
      const arrowSvg = renderArrowheadSvg(linear, 'start');
      if (arrowSvg) {
        g.insertAdjacentHTML('beforeend', arrowSvg);
      }
    }
  }

  return g;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Export elements to an SVG string.
 */
export function exportToSvg(
  elements: MavisElement[],
  options: SvgExportOptions,
  backgroundColor?: string,
): string {
  const doc = createSvgDocument(elements, options, backgroundColor);
  const serializer = new XMLSerializer();
  return serializer.serializeToString(doc);
}

/**
 * Create an SVG DOM element from elements.
 */
export function createSvgDocument(
  elements: MavisElement[],
  options: SvgExportOptions,
  backgroundColor?: string,
): SVGSVGElement {
  const liveElements = elements.filter((el) => !el.isDeleted);
  const bounds = computeElementsBounds(liveElements);

  const { padding, renderMode, includeBackground } = options;

  const viewX = (bounds?.x ?? 0) - padding;
  const viewY = (bounds?.y ?? 0) - padding;
  const viewW = (bounds?.width ?? 100) + padding * 2;
  const viewH = (bounds?.height ?? 100) + padding * 2;

  const doc = document.implementation.createDocument(
    'http://www.w3.org/2000/svg',
    'svg',
    null,
  );
  const svg = doc.documentElement as unknown as SVGSVGElement;
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', `${viewX} ${viewY} ${viewW} ${viewH}`);
  svg.setAttribute('width', String(viewW));
  svg.setAttribute('height', String(viewH));

  // Background
  if (includeBackground && backgroundColor) {
    const bg = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', String(viewX));
    bg.setAttribute('y', String(viewY));
    bg.setAttribute('width', String(viewW));
    bg.setAttribute('height', String(viewH));
    bg.setAttribute('fill', backgroundColor);
    svg.appendChild(bg);
  }

  // Set up rough.js SVG mode for sketchy rendering
  let roughSVG: unknown = null;
  if (renderMode === 'sketchy') {
    try {
      // rough.js SVG mode for sketchy rendering
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rough = (globalThis as any).__rough__;
      if (rough) {
        roughSVG = rough.svg(svg);
      }
    } catch {
      // Fall back to clean mode if rough.js isn't available
    }
  }

  for (const element of liveElements) {
    const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', elementTransform(element));
    if (element.opacity < 100) {
      g.setAttribute('opacity', String(element.opacity / 100));
    }

    if (renderMode === 'sketchy' && roughSVG) {
      const sketchyGroup = renderElementSketchy(svg, element, roughSVG);
      if (sketchyGroup) {
        g.appendChild(sketchyGroup);
      } else {
        // Fallback for types rough.js doesn't handle (text, portal, image)
        g.insertAdjacentHTML('beforeend', renderElementClean(element));
      }

      // Text and portal always use clean rendering even in sketchy mode
      if (element.type === 'text') {
        g.insertAdjacentHTML('beforeend', renderTextClean(element));
      }
    } else {
      g.insertAdjacentHTML('beforeend', renderElementClean(element));
    }

    svg.appendChild(g);
  }

  return svg;
}

function renderElementClean(element: MavisElement): string {
  switch (element.type) {
    case 'rectangle':
      return renderRectangleClean(element);
    case 'ellipse':
      return renderEllipseClean(element);
    case 'diamond':
      return renderDiamondClean(element);
    case 'triangle':
      return renderTriangleClean(element);
    case 'line':
    case 'arrow':
      return renderLinearClean(element);
    case 'freedraw':
      return renderFreedrawClean(element);
    case 'text':
      return renderTextClean(element);
    case 'portal':
      return renderPortalClean(element);
    case 'image':
      return ''; // Images need special handling
    default:
      return '';
  }
}

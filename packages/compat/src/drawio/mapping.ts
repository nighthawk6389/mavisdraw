import type { ElementType, Arrowhead, RoutingMode } from '@mavisdraw/types';

/**
 * Parse a draw.io style string into a Map.
 * Format: "rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;"
 * The first token may be a shape identifier without "=" (e.g., "ellipse;rounded=0;").
 */
export function parseDrawioStyle(style: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!style) return map;

  const parts = style.split(';').filter(Boolean);
  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) {
      // Shape identifier token (e.g., "ellipse", "rhombus", "text")
      map.set('_shape', part.trim());
    } else {
      const key = part.slice(0, eqIndex).trim();
      const value = part.slice(eqIndex + 1).trim();
      map.set(key, value);
    }
  }

  return map;
}

/**
 * Build a draw.io style string from a Map.
 */
export function buildDrawioStyle(styles: Map<string, string>): string {
  const parts: string[] = [];
  const shape = styles.get('_shape');
  if (shape) parts.push(shape);

  for (const [key, value] of styles) {
    if (key === '_shape') continue;
    parts.push(`${key}=${value}`);
  }

  return parts.join(';') + ';';
}

/**
 * Determine MavisDraw element type from draw.io style.
 */
export function inferElementType(style: Map<string, string>, isEdge: boolean): ElementType {
  if (isEdge) {
    return 'arrow';
  }

  const shape = style.get('_shape') || '';

  if (shape === 'ellipse' || style.get('shape') === 'ellipse') {
    return 'ellipse';
  }
  if (shape === 'rhombus' || style.get('shape') === 'rhombus') {
    return 'diamond';
  }
  if (
    shape === 'triangle' ||
    style.get('shape') === 'triangle' ||
    style.get('shape')?.includes('triangle')
  ) {
    return 'triangle';
  }
  if (shape === 'text') {
    return 'text';
  }

  return 'rectangle';
}

/**
 * Map draw.io edge style to MavisDraw RoutingMode.
 */
export function inferRoutingMode(style: Map<string, string>): RoutingMode {
  const edgeStyle = style.get('edgeStyle') || '';
  if (
    edgeStyle === 'orthogonalEdgeStyle' ||
    edgeStyle === 'elbowEdgeStyle'
  ) {
    return 'elbow';
  }
  if (style.get('curved') === '1') {
    return 'curved';
  }
  return 'straight';
}

/**
 * Map draw.io arrowhead style to MavisDraw Arrowhead.
 */
export function mapArrowhead(arrowStyle: string | undefined): Arrowhead {
  if (!arrowStyle || arrowStyle === 'none') return 'none';
  switch (arrowStyle) {
    case 'block':
    case 'blockThin':
      return 'triangle';
    case 'classic':
    case 'classicThin':
      return 'arrow';
    case 'oval':
    case 'circle':
      return 'dot';
    case 'dash':
      return 'bar';
    case 'open':
    case 'openThin':
      return 'arrow';
    default:
      return 'arrow';
  }
}

/**
 * Map MavisDraw Arrowhead to draw.io arrow style string.
 */
export function mapArrowheadToDrawio(arrowhead: Arrowhead): string {
  switch (arrowhead) {
    case 'none':
      return 'none';
    case 'arrow':
      return 'classic';
    case 'triangle':
      return 'block';
    case 'dot':
      return 'oval';
    case 'bar':
      return 'dash';
    default:
      return 'classic';
  }
}

/**
 * Extract colors from draw.io style.
 */
export function mapColors(style: Map<string, string>): {
  strokeColor: string;
  backgroundColor: string;
} {
  return {
    strokeColor: style.get('strokeColor') || '#000000',
    backgroundColor: style.get('fillColor') || 'transparent',
  };
}

/**
 * Extract stroke width from draw.io style.
 */
export function mapStrokeWidth(style: Map<string, string>): number {
  const sw = style.get('strokeWidth');
  return sw ? parseFloat(sw) || 2 : 2;
}

/**
 * Extract opacity from draw.io style (0-100).
 */
export function mapOpacity(style: Map<string, string>): number {
  const op = style.get('opacity');
  return op ? parseFloat(op) || 100 : 100;
}

/**
 * Check if the style indicates dashed stroke.
 */
export function mapStrokeStyle(style: Map<string, string>): 'solid' | 'dashed' | 'dotted' {
  if (style.get('dashed') === '1') return 'dashed';
  if (style.get('dotted') === '1') return 'dotted';
  return 'solid';
}

/**
 * Check if rectangle is rounded.
 */
export function mapRoundness(style: Map<string, string>): number {
  if (style.get('rounded') === '1') return 8;
  return 0;
}

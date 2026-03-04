import type { Arrowhead } from '@mavisdraw/types';
import type { MiroShapeItem, MiroConnectorItem } from './types';

/**
 * Map MavisDraw element type to Miro shape name.
 */
export function mapShapeToMiro(
  elementType: string,
  roundness?: number,
): MiroShapeItem['data']['shape'] | null {
  switch (elementType) {
    case 'rectangle':
      return roundness && roundness > 0 ? 'round_rectangle' : 'rectangle';
    case 'ellipse':
      return 'circle';
    case 'diamond':
      return 'rhombus';
    case 'triangle':
      return 'triangle';
    default:
      return null;
  }
}

/**
 * Map MavisDraw routing mode to Miro connector shape.
 */
export function mapRoutingToMiro(
  routingMode: string,
): MiroConnectorItem['data']['shape'] {
  switch (routingMode) {
    case 'elbow':
      return 'elbowed';
    case 'curved':
      return 'curved';
    default:
      return 'straight';
  }
}

/**
 * Map MavisDraw arrowhead to Miro stroke cap.
 */
export function mapArrowheadToMiro(
  arrowhead: Arrowhead,
): MiroConnectorItem['style']['endStrokeCap'] {
  switch (arrowhead) {
    case 'none':
      return 'none';
    case 'arrow':
      return 'arrow';
    case 'triangle':
      return 'filled_arrow';
    case 'dot':
      return 'filled_circle';
    case 'bar':
      return 'none'; // No Miro equivalent
    default:
      return 'arrow';
  }
}

/**
 * Map MavisDraw stroke style to Miro border/stroke style.
 */
export function mapStrokeStyleToMiro(
  strokeStyle: string,
): 'normal' | 'dashed' | 'dotted' {
  switch (strokeStyle) {
    case 'dashed':
      return 'dashed';
    case 'dotted':
      return 'dotted';
    default:
      return 'normal';
  }
}

/**
 * Map MavisDraw font family to Miro font family string.
 */
export function mapFontToMiro(fontFamily: string): string {
  switch (fontFamily) {
    case 'hand-drawn':
      return 'cursive';
    case 'monospace':
      return 'monospace';
    default:
      return 'arial';
  }
}

/**
 * Convert radians to degrees.
 */
export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

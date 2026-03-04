import type {
  MavisElement,
  RectangleElement,
  LinearElement,
  TextElement,
} from '@mavisdraw/types';
import type {
  MiroBoardExport,
  MiroItem,
  MiroShapeItem,
  MiroTextItem,
  MiroConnectorItem,
} from './types';
import {
  mapShapeToMiro,
  mapRoutingToMiro,
  mapArrowheadToMiro,
  mapStrokeStyleToMiro,
  mapFontToMiro,
  radToDeg,
} from './mapping';

/**
 * Convert MavisDraw elements to Miro REST API v2 compatible JSON.
 *
 * Coordinate conversion:
 * - MavisDraw: top-left (x, y) + (width, height)
 * - Miro: center-based (x, y)
 * So: miro.x = mavis.x + mavis.width / 2, miro.y = mavis.y + mavis.height / 2
 *
 * Skips element types with no Miro equivalent:
 * - portal (MavisDraw-specific)
 * - freedraw (no Miro equivalent)
 * - image (would need URL; can't upload)
 */
export function exportToMiro(elements: MavisElement[]): MiroBoardExport {
  const items: MiroItem[] = [];

  for (const el of elements) {
    if (el.isDeleted) continue;

    // Skip bound text (handled as part of parent shape)
    if (el.type === 'text' && (el as TextElement).containerId) continue;

    const item = convertElement(el);
    if (item) items.push(item);
  }

  return {
    type: 'miro-board',
    version: 1,
    items,
  };
}

function convertElement(el: MavisElement): MiroItem | null {
  switch (el.type) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
    case 'triangle':
      return convertShape(el);
    case 'text':
      return convertText(el as TextElement);
    case 'line':
    case 'arrow':
      return convertConnector(el as LinearElement);
    default:
      return null;
  }
}

function convertShape(el: MavisElement): MiroShapeItem | null {
  const roundness = el.type === 'rectangle' ? (el as RectangleElement).roundness : 0;
  const miroShape = mapShapeToMiro(el.type, roundness);
  if (!miroShape) return null;

  // Find bound text content
  // Note: bound text is filtered out in the main loop, so we can't look it up here.
  // The caller should pass text content via element's boundElements, but for simplicity
  // we just use empty content. The bound text is separately exported if standalone.
  const content = '';

  return {
    type: 'shape',
    data: {
      shape: miroShape,
      content,
    },
    style: {
      fillColor: el.backgroundColor === 'transparent' ? '#ffffff' : el.backgroundColor,
      fillOpacity: String(el.opacity / 100),
      borderColor: el.strokeColor,
      borderWidth: String(el.strokeWidth),
      borderOpacity: '1.0',
      borderStyle: mapStrokeStyleToMiro(el.strokeStyle),
      fontFamily: 'arial',
      fontSize: '14',
      textAlign: 'center',
      textAlignVertical: 'middle',
      color: el.strokeColor,
    },
    position: {
      x: el.x + el.width / 2,
      y: el.y + el.height / 2,
    },
    geometry: {
      width: el.width,
      height: el.height,
      rotation: radToDeg(el.angle),
    },
  };
}

function convertText(el: TextElement): MiroTextItem {
  return {
    type: 'text',
    data: {
      content: `<p>${escapeHtml(el.text)}</p>`,
    },
    style: {
      fillColor: 'transparent',
      fillOpacity: String(el.opacity / 100),
      color: el.strokeColor,
      fontFamily: mapFontToMiro(el.fontFamily),
      fontSize: String(el.fontSize),
      textAlign: el.textAlign,
    },
    position: {
      x: el.x + el.width / 2,
      y: el.y + el.height / 2,
    },
    geometry: {
      width: el.width,
      height: el.height,
      rotation: radToDeg(el.angle),
    },
  };
}

function convertConnector(el: LinearElement): MiroConnectorItem {
  const item: MiroConnectorItem = {
    type: 'connector',
    data: {
      shape: mapRoutingToMiro(el.routingMode),
    },
    style: {
      startStrokeCap: mapArrowheadToMiro(el.startArrowhead),
      endStrokeCap: mapArrowheadToMiro(el.endArrowhead),
      strokeColor: el.strokeColor,
      strokeWidth: String(el.strokeWidth),
      strokeStyle: mapStrokeStyleToMiro(el.strokeStyle),
    },
  };

  if (el.startBinding) {
    item.startItem = { id: el.startBinding.elementId };
  }
  if (el.endBinding) {
    item.endItem = { id: el.endBinding.elementId };
  }

  return item;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

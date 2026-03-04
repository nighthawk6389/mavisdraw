import type {
  MavisElement,
  RectangleElement,
  LinearElement,
  TextElement,
} from '@mavisdraw/types';
import type { ExcalidrawFile, ExcalidrawElement } from './types';
import {
  FONT_FAMILY_REVERSE,
  mavisRoundnessToExcalidraw,
  mapArrowheadToExcalidraw,
} from './mapping';

/**
 * Convert MavisDraw elements to Excalidraw format.
 *
 * Skips element types with no Excalidraw equivalent:
 * - 'portal' (MavisDraw-specific)
 * - 'triangle' (no Excalidraw equivalent)
 */
export function exportToExcalidraw(
  elements: MavisElement[],
  appState?: { viewBackgroundColor: string; gridSize: number },
): ExcalidrawFile {
  const excElements: ExcalidrawElement[] = [];

  for (const el of elements) {
    if (el.isDeleted) continue;
    if (el.type === 'portal' || el.type === 'triangle') continue;

    const converted = convertToExcalidraw(el);
    if (converted) {
      excElements.push(converted);
    }
  }

  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://mavisdraw.app',
    elements: excElements,
    appState: {
      viewBackgroundColor: appState?.viewBackgroundColor || '#ffffff',
      gridSize: appState?.gridSize ?? null,
    },
  };
}

function convertToExcalidraw(el: MavisElement): ExcalidrawElement | null {
  const base: Partial<ExcalidrawElement> = {
    id: el.id,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    angle: el.angle,
    strokeColor: el.strokeColor,
    backgroundColor: el.backgroundColor,
    fillStyle: el.fillStyle === 'none' ? 'hachure' : el.fillStyle,
    strokeWidth: el.strokeWidth,
    strokeStyle: el.strokeStyle,
    roughness: el.roughness,
    opacity: el.opacity,
    seed: el.seed,
    version: el.version,
    versionNonce: Math.floor(Math.random() * 2147483647),
    isDeleted: false,
    groupIds: el.groupIds,
    boundElements: el.boundElements.length > 0 ? el.boundElements : null,
    updated: el.updatedAt,
    link: null,
    locked: el.isLocked,
  };

  switch (el.type) {
    case 'rectangle': {
      const rect = el as RectangleElement;
      return {
        ...base,
        type: 'rectangle',
        roundness: mavisRoundnessToExcalidraw(rect.roundness),
      } as ExcalidrawElement;
    }

    case 'ellipse':
      return {
        ...base,
        type: 'ellipse',
        roundness: null,
      } as ExcalidrawElement;

    case 'diamond':
      return {
        ...base,
        type: 'diamond',
        roundness: null,
      } as ExcalidrawElement;

    case 'line':
    case 'arrow':
    case 'freedraw': {
      const linear = el as LinearElement;
      return {
        ...base,
        type: el.type,
        points: linear.points,
        startBinding: linear.startBinding
          ? { elementId: linear.startBinding.elementId, focus: 0, gap: linear.startBinding.gap }
          : null,
        endBinding: linear.endBinding
          ? { elementId: linear.endBinding.elementId, focus: 0, gap: linear.endBinding.gap }
          : null,
        startArrowhead: mapArrowheadToExcalidraw(linear.startArrowhead),
        endArrowhead: mapArrowheadToExcalidraw(linear.endArrowhead),
        lastCommittedPoint: linear.points.length > 0
          ? linear.points[linear.points.length - 1]
          : null,
        elbowed: linear.routingMode === 'elbow',
        roundness: null,
      } as ExcalidrawElement;
    }

    case 'text': {
      const text = el as TextElement;
      return {
        ...base,
        type: 'text',
        text: text.text,
        originalText: text.text,
        fontSize: text.fontSize,
        fontFamily: FONT_FAMILY_REVERSE[text.fontFamily] || 1,
        textAlign: text.textAlign,
        verticalAlign: text.verticalAlign,
        containerId: text.containerId,
        lineHeight: text.lineHeight,
        autoResize: true,
        roundness: null,
      } as ExcalidrawElement;
    }

    case 'image':
      return {
        ...base,
        type: 'image',
        fileId: null,
        scale: [1, 1],
        status: 'saved',
        roundness: null,
      } as ExcalidrawElement;

    default:
      return null;
  }
}

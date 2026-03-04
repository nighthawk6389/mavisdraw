import type {
  MavisElement,
  Diagram,
  RectangleElement,
  EllipseElement,
  DiamondElement,
  TriangleElement,
  LinearElement,
  TextElement,
  RenderMode,
} from '@mavisdraw/types';
import type { DrawioFile, DrawioDiagram, DrawioCell, DrawioGeometry } from './types';
import {
  parseDrawioStyle,
  inferElementType,
  inferRoutingMode,
  mapArrowhead,
  mapColors,
  mapStrokeWidth,
  mapOpacity,
  mapStrokeStyle,
  mapRoundness,
} from './mapping';

let idCounter = 0;
function generateId(): string {
  return `dio-${Date.now()}-${++idCounter}`;
}

/**
 * Parse draw.io XML and convert to MavisDraw elements.
 * Uses browser DOMParser (no external XML library needed).
 * Multi-page: each <diagram> element → separate MavisDraw Diagram.
 */
export function importFromDrawio(xmlString: string): {
  diagrams: Diagram[];
  elements: MavisElement[];
} {
  idCounter = 0;

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  const errorNode = doc.querySelector('parsererror');
  if (errorNode) {
    throw new Error('Invalid draw.io XML: parse error');
  }

  const drawioFile = parseDrawioXml(doc);
  return convertDrawioFile(drawioFile);
}

function parseDrawioXml(doc: Document): DrawioFile {
  const diagramNodes = doc.querySelectorAll('diagram');
  const diagrams: DrawioDiagram[] = [];

  for (const diagNode of diagramNodes) {
    const name = diagNode.getAttribute('name') || 'Untitled';
    const id = diagNode.getAttribute('id') || generateId();

    // Find mxGraphModel — could be direct child or nested
    const graphModel = diagNode.querySelector('mxGraphModel');
    if (!graphModel) continue;

    const background = graphModel.getAttribute('background') || undefined;
    const gridSize = parseInt(graphModel.getAttribute('gridSize') || '10', 10);

    const cells: DrawioCell[] = [];
    const cellNodes = graphModel.querySelectorAll('mxCell');

    for (const cellNode of cellNodes) {
      const cell = parseMxCell(cellNode);
      cells.push(cell);
    }

    // Also check for <object> wrappers (custom metadata)
    const objectNodes = graphModel.querySelectorAll('object');
    for (const objNode of objectNodes) {
      const innerCell = objNode.querySelector('mxCell');
      if (innerCell) {
        const cell = parseMxCell(innerCell);
        cell.id = objNode.getAttribute('id') || cell.id;
        cell.value = objNode.getAttribute('label') || cell.value;
        cells.push(cell);
      }
    }

    diagrams.push({ name, id, cells, gridSize, background: background || undefined });
  }

  return { diagrams };
}

function parseMxCell(cellNode: Element): DrawioCell {
  const id = cellNode.getAttribute('id') || '';
  const value = cellNode.getAttribute('value') || '';
  const style = cellNode.getAttribute('style') || '';
  const vertex = cellNode.getAttribute('vertex') === '1';
  const edge = cellNode.getAttribute('edge') === '1';
  const source = cellNode.getAttribute('source') || undefined;
  const target = cellNode.getAttribute('target') || undefined;
  const parent = cellNode.getAttribute('parent') || '1';

  let geometry: DrawioGeometry | undefined;
  const geoNode = cellNode.querySelector('mxGeometry');
  if (geoNode) {
    const points: { x: number; y: number }[] = [];
    const arrayNode = geoNode.querySelector('Array');
    if (arrayNode) {
      const pointNodes = arrayNode.querySelectorAll('mxPoint');
      for (const pt of pointNodes) {
        points.push({
          x: parseFloat(pt.getAttribute('x') || '0'),
          y: parseFloat(pt.getAttribute('y') || '0'),
        });
      }
    }

    geometry = {
      x: parseFloat(geoNode.getAttribute('x') || '0'),
      y: parseFloat(geoNode.getAttribute('y') || '0'),
      width: parseFloat(geoNode.getAttribute('width') || '100'),
      height: parseFloat(geoNode.getAttribute('height') || '60'),
      relative: geoNode.getAttribute('relative') === '1',
      points: points.length > 0 ? points : undefined,
    };
  }

  return { id, value, style, vertex, edge, source, target, parent, geometry };
}

function convertDrawioFile(file: DrawioFile): {
  diagrams: Diagram[];
  elements: MavisElement[];
} {
  const allDiagrams: Diagram[] = [];
  const allElements: MavisElement[] = [];

  for (let i = 0; i < file.diagrams.length; i++) {
    const dioDiag = file.diagrams[i];
    const diagramId = generateId();

    const diagram: Diagram = {
      id: diagramId,
      projectId: 'imported',
      parentDiagramId: i === 0 ? null : allDiagrams[0]?.id || null,
      parentPortalId: null,
      title: dioDiag.name,
      viewBackgroundColor: dioDiag.background || '#ffffff',
      gridEnabled: true,
      gridSize: dioDiag.gridSize || 10,
      renderMode: 'clean' as RenderMode,
      layers: [
        { id: 'default', name: 'Layer 1', isVisible: true, isLocked: false, opacity: 100, order: 0 },
      ],
      createdBy: 'import',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    allDiagrams.push(diagram);

    // Build ID map for this diagram
    const idMap = new Map<string, string>();
    for (const cell of dioDiag.cells) {
      if (cell.id === '0' || cell.id === '1') continue; // Skip root cells
      idMap.set(cell.id, generateId());
    }

    // Convert cells to elements
    for (const cell of dioDiag.cells) {
      if (cell.id === '0' || cell.id === '1') continue;
      const newId = idMap.get(cell.id)!;

      const element = convertCell(cell, newId, diagramId, idMap);
      if (element) {
        allElements.push(element);

        // If vertex has text value, create a bound text element
        if (cell.vertex && cell.value && element.type !== 'text') {
          const textId = generateId();
          const textEl: TextElement = {
            id: textId,
            type: 'text',
            diagramId,
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
            angle: 0,
            opacity: 100,
            strokeColor: '#000000',
            backgroundColor: 'transparent',
            fillStyle: 'none',
            strokeWidth: 1,
            strokeStyle: 'solid',
            roughness: 0,
            seed: Math.floor(Math.random() * 2147483647),
            renderMode: 'clean',
            layerId: 'default',
            groupIds: [],
            isLocked: false,
            isDeleted: false,
            boundElements: [],
            version: 1,
            updatedAt: Date.now(),
            text: stripHtml(cell.value),
            fontSize: 14,
            fontFamily: 'sans-serif',
            textAlign: 'center',
            verticalAlign: 'middle',
            containerId: newId,
            lineHeight: 1.25,
          };
          allElements.push(textEl);

          // Add bound reference to parent
          element.boundElements.push({ id: textId, type: 'text' });
        }
      }
    }
  }

  return { diagrams: allDiagrams, elements: allElements };
}

function convertCell(
  cell: DrawioCell,
  newId: string,
  diagramId: string,
  idMap: Map<string, string>,
): MavisElement | null {
  const style = parseDrawioStyle(cell.style);
  const geo = cell.geometry;

  const colors = mapColors(style);

  const base = {
    id: newId,
    diagramId,
    x: geo?.x || 0,
    y: geo?.y || 0,
    width: geo?.width || 100,
    height: geo?.height || 60,
    angle: 0,
    opacity: mapOpacity(style),
    strokeColor: colors.strokeColor,
    backgroundColor: colors.backgroundColor,
    fillStyle: colors.backgroundColor === 'transparent' ? 'none' as const : 'solid' as const,
    strokeWidth: mapStrokeWidth(style),
    strokeStyle: mapStrokeStyle(style),
    roughness: 0,
    seed: Math.floor(Math.random() * 2147483647),
    renderMode: 'clean' as RenderMode,
    layerId: 'default',
    groupIds: [],
    isLocked: false,
    isDeleted: false,
    boundElements: [] as { id: string; type: string }[],
    version: 1,
    updatedAt: Date.now(),
  };

  const elementType = inferElementType(style, cell.edge);

  switch (elementType) {
    case 'rectangle':
      return {
        ...base,
        type: 'rectangle',
        roundness: mapRoundness(style),
      } as RectangleElement;

    case 'ellipse':
      return { ...base, type: 'ellipse' } as EllipseElement;

    case 'diamond':
      return { ...base, type: 'diamond' } as DiamondElement;

    case 'triangle':
      return { ...base, type: 'triangle' } as TriangleElement;

    case 'text':
      return {
        ...base,
        type: 'text',
        text: stripHtml(cell.value),
        fontSize: parseInt(style.get('fontSize') || '14', 10),
        fontFamily: 'sans-serif',
        textAlign: (style.get('align') as 'left' | 'center' | 'right') || 'center',
        verticalAlign: (style.get('verticalAlign') as 'top' | 'middle' | 'bottom') || 'middle',
        containerId: null,
        lineHeight: 1.25,
      } as TextElement;

    case 'arrow': {
      // Build points from geometry
      const points: [number, number][] = [[0, 0]];
      if (geo?.points) {
        for (const pt of geo.points) {
          points.push([pt.x - (geo.x || 0), pt.y - (geo.y || 0)]);
        }
      }
      // Add endpoint
      const endX = (geo?.width || 100);
      const endY = (geo?.height || 0);
      points.push([endX, endY]);

      return {
        ...base,
        type: 'arrow',
        width: 0,
        height: 0,
        points,
        startBinding: cell.source
          ? { elementId: idMap.get(cell.source) || cell.source, gap: 5 }
          : null,
        endBinding: cell.target
          ? { elementId: idMap.get(cell.target) || cell.target, gap: 5 }
          : null,
        routingMode: inferRoutingMode(style),
        startArrowhead: mapArrowhead(style.get('startArrow')),
        endArrowhead: mapArrowhead(style.get('endArrow') || 'classic'),
      } as LinearElement;
    }

    default:
      return null;
  }
}

/** Strip HTML tags from a string (draw.io values often contain HTML). */
function stripHtml(html: string): string {
  if (!html) return '';
  // Use DOMParser for safe HTML stripping
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  } catch {
    return html.replace(/<[^>]*>/g, '');
  }
}

import type {
  MavisElement,
  Diagram,
  RectangleElement,
  EllipseElement,
  DiamondElement,
  LinearElement,
  TextElement,
  ImageElement,
  RoutingMode,
  RenderMode,
} from '@mavisdraw/types';
import type { ExcalidrawFile, ExcalidrawElement } from './types';
import {
  FONT_FAMILY_MAP,
  excalidrawRoundnessToMavis,
  mapArrowheadToMavis,
  mapFillStyle,
} from './mapping';

let idCounter = 0;
function generateId(): string {
  return `imp-${Date.now()}-${++idCounter}`;
}

/**
 * Convert an Excalidraw file to MavisDraw format.
 *
 * Creates a single root diagram containing all elements.
 * Skips 'frame' elements (no MavisDraw equivalent).
 * Remaps all IDs and fixes cross-references.
 */
export function importFromExcalidraw(data: ExcalidrawFile): {
  diagrams: Diagram[];
  elements: MavisElement[];
} {
  idCounter = 0;
  const diagramId = generateId();
  const idMap = new Map<string, string>(); // old ID → new ID

  // First pass: generate new IDs
  for (const el of data.elements) {
    if (el.type === 'frame') continue;
    idMap.set(el.id, generateId());
  }

  // Second pass: convert elements
  const elements: MavisElement[] = [];

  for (const excEl of data.elements) {
    if (excEl.type === 'frame') continue;
    if (excEl.isDeleted) continue;

    const newId = idMap.get(excEl.id)!;
    const converted = convertElement(excEl, newId, diagramId, idMap);
    if (converted) {
      elements.push(converted);
    }
  }

  // Create root diagram
  const renderMode: RenderMode =
    data.elements.some((el) => el.roughness > 0) ? 'sketchy' : 'clean';

  const diagram: Diagram = {
    id: diagramId,
    projectId: 'imported',
    parentDiagramId: null,
    parentPortalId: null,
    title: 'Imported from Excalidraw',
    viewBackgroundColor: data.appState?.viewBackgroundColor || '#ffffff',
    gridEnabled: data.appState?.gridSize != null,
    gridSize: data.appState?.gridSize || 20,
    renderMode,
    layers: [{ id: 'default', name: 'Layer 1', isVisible: true, isLocked: false, opacity: 100, order: 0 }],
    createdBy: 'import',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return { diagrams: [diagram], elements };
}

function convertElement(
  excEl: ExcalidrawElement,
  newId: string,
  diagramId: string,
  idMap: Map<string, string>,
): MavisElement | null {
  const base = {
    id: newId,
    diagramId,
    x: excEl.x,
    y: excEl.y,
    width: excEl.width,
    height: excEl.height,
    angle: excEl.angle,
    opacity: excEl.opacity,
    strokeColor: excEl.strokeColor,
    backgroundColor: excEl.backgroundColor,
    fillStyle: mapFillStyle(excEl.fillStyle),
    strokeWidth: excEl.strokeWidth,
    strokeStyle: excEl.strokeStyle as 'solid' | 'dashed' | 'dotted',
    roughness: excEl.roughness,
    seed: excEl.seed,
    renderMode: (excEl.roughness > 0 ? 'sketchy' : 'clean') as RenderMode,
    layerId: 'default',
    groupIds: excEl.groupIds || [],
    isLocked: excEl.locked || false,
    isDeleted: false,
    boundElements: remapBoundElements(excEl.boundElements, idMap),
    version: excEl.version || 1,
    updatedAt: excEl.updated || Date.now(),
  };

  switch (excEl.type) {
    case 'rectangle':
      return {
        ...base,
        type: 'rectangle',
        roundness: excalidrawRoundnessToMavis(excEl.roundness),
      } as RectangleElement;

    case 'ellipse':
      return { ...base, type: 'ellipse' } as EllipseElement;

    case 'diamond':
      return { ...base, type: 'diamond' } as DiamondElement;

    case 'line':
    case 'arrow':
    case 'freedraw':
      return {
        ...base,
        type: excEl.type,
        points: excEl.points || [[0, 0]],
        startBinding: remapBinding(excEl.startBinding, idMap),
        endBinding: remapBinding(excEl.endBinding, idMap),
        routingMode: inferRoutingMode(excEl),
        startArrowhead: mapArrowheadToMavis(excEl.startArrowhead),
        endArrowhead: mapArrowheadToMavis(excEl.endArrowhead),
      } as LinearElement;

    case 'text':
      return {
        ...base,
        type: 'text',
        text: excEl.text || '',
        fontSize: excEl.fontSize || 20,
        fontFamily: FONT_FAMILY_MAP[excEl.fontFamily || 1] || 'hand-drawn',
        textAlign: (excEl.textAlign as 'left' | 'center' | 'right') || 'left',
        verticalAlign: (excEl.verticalAlign as 'top' | 'middle' | 'bottom') || 'top',
        containerId: excEl.containerId ? (idMap.get(excEl.containerId) ?? null) : null,
        lineHeight: excEl.lineHeight || 1.25,
      } as TextElement;

    case 'image':
      return {
        ...base,
        type: 'image',
        imageUrl: '', // Image data not transferable directly
        aspectRatio: excEl.width && excEl.height ? excEl.width / excEl.height : 1,
      } as ImageElement;

    default:
      return null;
  }
}

function remapBoundElements(
  boundElements: { id: string; type: string }[] | null | undefined,
  idMap: Map<string, string>,
): { id: string; type: string }[] {
  if (!boundElements) return [];
  return boundElements
    .map((be) => ({
      id: idMap.get(be.id) ?? be.id,
      type: be.type,
    }))
    .filter((be) => idMap.has(be.id) || be.id === be.id);
}

function remapBinding(
  binding: { elementId: string; focus: number; gap: number } | null | undefined,
  idMap: Map<string, string>,
): { elementId: string; gap: number } | null {
  if (!binding) return null;
  const newId = idMap.get(binding.elementId);
  if (!newId) return null;
  return { elementId: newId, gap: binding.gap };
}

function inferRoutingMode(excEl: ExcalidrawElement): RoutingMode {
  if (excEl.elbowed) return 'elbow';
  if (excEl.points && excEl.points.length === 2) return 'curved';
  return 'straight';
}

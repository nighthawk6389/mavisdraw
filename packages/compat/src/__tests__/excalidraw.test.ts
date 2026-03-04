import { describe, it, expect } from 'vitest';
import { importFromExcalidraw } from '../excalidraw/import';
import { exportToExcalidraw } from '../excalidraw/export';
import type { ExcalidrawFile } from '../excalidraw/types';
import type { RectangleElement, LinearElement, TextElement } from '@mavisdraw/types';

function makeExcalidrawFile(
  elements: ExcalidrawFile['elements'] = [],
): ExcalidrawFile {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements,
    appState: {
      viewBackgroundColor: '#ffffff',
      gridSize: null,
    },
  };
}

function makeExcalidrawRect(overrides = {}): ExcalidrawFile['elements'][0] {
  return {
    id: 'exc-rect-1',
    type: 'rectangle',
    x: 100,
    y: 200,
    width: 150,
    height: 80,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: '#dae8fc',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    seed: 12345,
    version: 5,
    versionNonce: 67890,
    isDeleted: false,
    groupIds: [],
    boundElements: null,
    updated: 1000,
    link: null,
    locked: false,
    roundness: { type: 3 },
    ...overrides,
  };
}

describe('importFromExcalidraw', () => {
  it('imports a rectangle with correct properties', () => {
    const file = makeExcalidrawFile([makeExcalidrawRect()]);
    const result = importFromExcalidraw(file);

    expect(result.diagrams).toHaveLength(1);
    expect(result.elements).toHaveLength(1);

    const el = result.elements[0] as RectangleElement;
    expect(el.type).toBe('rectangle');
    expect(el.x).toBe(100);
    expect(el.y).toBe(200);
    expect(el.width).toBe(150);
    expect(el.height).toBe(80);
    expect(el.strokeColor).toBe('#1e1e1e');
    expect(el.backgroundColor).toBe('#dae8fc');
    expect(el.roundness).toBeGreaterThan(0); // Excalidraw type 3 → nonzero
  });

  it('maps fontFamily numbers to strings', () => {
    const textEl = {
      ...makeExcalidrawRect(),
      id: 'exc-text-1',
      type: 'text' as const,
      text: 'Hello',
      fontSize: 20,
      fontFamily: 1,
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: null,
      lineHeight: 1.25,
    };
    const file = makeExcalidrawFile([textEl]);
    const result = importFromExcalidraw(file);

    const el = result.elements[0] as TextElement;
    expect(el.fontFamily).toBe('hand-drawn');
  });

  it('skips frame elements', () => {
    const frameEl = {
      ...makeExcalidrawRect(),
      id: 'exc-frame-1',
      type: 'frame' as const,
    };
    const file = makeExcalidrawFile([frameEl]);
    const result = importFromExcalidraw(file);

    expect(result.elements).toHaveLength(0);
  });

  it('skips deleted elements', () => {
    const deleted = makeExcalidrawRect({ id: 'del', isDeleted: true });
    const file = makeExcalidrawFile([deleted]);
    const result = importFromExcalidraw(file);

    expect(result.elements).toHaveLength(0);
  });

  it('remaps binding references', () => {
    const rect = makeExcalidrawRect({
      id: 'exc-rect',
      boundElements: [{ id: 'exc-arrow', type: 'arrow' }],
    });
    const arrow = {
      ...makeExcalidrawRect(),
      id: 'exc-arrow',
      type: 'arrow' as const,
      points: [[0, 0], [100, 50]] as [number, number][],
      startBinding: { elementId: 'exc-rect', focus: 0.5, gap: 5 },
      endBinding: null,
      startArrowhead: null,
      endArrowhead: 'arrow',
      elbowed: false,
    };
    const file = makeExcalidrawFile([rect, arrow]);
    const result = importFromExcalidraw(file);

    expect(result.elements).toHaveLength(2);
    const arrowEl = result.elements.find((e) => e.type === 'arrow') as LinearElement;
    const rectEl = result.elements.find((e) => e.type === 'rectangle');

    // Binding should reference the NEW rect ID, not the old Excalidraw ID
    expect(arrowEl.startBinding).not.toBeNull();
    expect(arrowEl.startBinding!.elementId).toBe(rectEl!.id);
    // focus should be dropped
    expect(arrowEl.startBinding).not.toHaveProperty('focus');
  });

  it('maps zigzag fillStyle to hachure', () => {
    const el = makeExcalidrawRect({ fillStyle: 'zigzag' });
    const file = makeExcalidrawFile([el]);
    const result = importFromExcalidraw(file);
    expect(result.elements[0].fillStyle).toBe('hachure');
  });

  it('infers render mode from roughness', () => {
    const smooth = makeExcalidrawRect({ roughness: 0 });
    const file = makeExcalidrawFile([smooth]);
    const result = importFromExcalidraw(file);
    expect(result.elements[0].renderMode).toBe('clean');
  });

  it('creates diagram with correct appState', () => {
    const file = makeExcalidrawFile([]);
    file.appState.viewBackgroundColor = '#f0f0f0';
    file.appState.gridSize = 15;

    const result = importFromExcalidraw(file);
    expect(result.diagrams[0].viewBackgroundColor).toBe('#f0f0f0');
    expect(result.diagrams[0].gridSize).toBe(15);
    expect(result.diagrams[0].gridEnabled).toBe(true);
  });
});

describe('exportToExcalidraw', () => {
  it('exports rectangle elements', () => {
    const rect: RectangleElement = {
      id: 'mv-rect',
      type: 'rectangle',
      diagramId: 'diag-1',
      x: 50,
      y: 100,
      width: 200,
      height: 100,
      angle: 0,
      opacity: 100,
      strokeColor: '#000',
      backgroundColor: '#fff',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      seed: 111,
      renderMode: 'sketchy',
      layerId: 'default',
      groupIds: ['g1'],
      isLocked: false,
      isDeleted: false,
      boundElements: [],
      version: 3,
      updatedAt: 2000,
      roundness: 8,
    };

    const file = exportToExcalidraw([rect]);
    expect(file.type).toBe('excalidraw');
    expect(file.version).toBe(2);
    expect(file.elements).toHaveLength(1);
    expect(file.elements[0].type).toBe('rectangle');
    expect(file.elements[0].roundness).toEqual({ type: 3 }); // numeric 8 → { type: 3 }
    expect(file.elements[0].groupIds).toEqual(['g1']);
  });

  it('skips portal elements', () => {
    const portal = {
      id: 'portal-1',
      type: 'portal' as const,
      diagramId: 'diag-1',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      angle: 0,
      opacity: 100,
      strokeColor: '#000',
      backgroundColor: '#fff',
      fillStyle: 'solid' as const,
      strokeWidth: 2,
      strokeStyle: 'solid' as const,
      roughness: 0,
      seed: 1,
      renderMode: 'clean' as const,
      layerId: 'default',
      groupIds: [],
      isLocked: false,
      isDeleted: false,
      boundElements: [],
      version: 1,
      updatedAt: 1000,
      targetDiagramId: 'child',
      label: 'Sub',
      thumbnailDataUrl: null,
      portalStyle: 'card' as const,
      githubLink: null,
    };

    const file = exportToExcalidraw([portal]);
    expect(file.elements).toHaveLength(0);
  });

  it('skips triangle elements', () => {
    const tri = {
      id: 'tri-1',
      type: 'triangle' as const,
      diagramId: 'diag-1',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      angle: 0,
      opacity: 100,
      strokeColor: '#000',
      backgroundColor: '#fff',
      fillStyle: 'solid' as const,
      strokeWidth: 2,
      strokeStyle: 'solid' as const,
      roughness: 0,
      seed: 1,
      renderMode: 'clean' as const,
      layerId: 'default',
      groupIds: [],
      isLocked: false,
      isDeleted: false,
      boundElements: [],
      version: 1,
      updatedAt: 1000,
    };

    const file = exportToExcalidraw([tri]);
    expect(file.elements).toHaveLength(0);
  });

  it('maps text fontFamily to number', () => {
    const text: TextElement = {
      id: 'text-1',
      type: 'text',
      diagramId: 'diag-1',
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      angle: 0,
      opacity: 100,
      strokeColor: '#000',
      backgroundColor: 'transparent',
      fillStyle: 'none',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      seed: 1,
      renderMode: 'clean',
      layerId: 'default',
      groupIds: [],
      isLocked: false,
      isDeleted: false,
      boundElements: [],
      version: 1,
      updatedAt: 1000,
      text: 'Hello',
      fontSize: 20,
      fontFamily: 'monospace',
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: null,
      lineHeight: 1.25,
    };

    const file = exportToExcalidraw([text]);
    expect(file.elements[0].fontFamily).toBe(3); // monospace → 3
  });

  it('filters deleted elements', () => {
    const rect: RectangleElement = {
      id: 'del-rect',
      type: 'rectangle',
      diagramId: 'diag-1',
      x: 0, y: 0, width: 100, height: 50,
      angle: 0, opacity: 100,
      strokeColor: '#000', backgroundColor: '#fff',
      fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid',
      roughness: 0, seed: 1, renderMode: 'clean',
      layerId: 'default', groupIds: [],
      isLocked: false, isDeleted: true,
      boundElements: [], version: 1, updatedAt: 1000,
      roundness: 0,
    };

    const file = exportToExcalidraw([rect]);
    expect(file.elements).toHaveLength(0);
  });
});

import { describe, it, expect } from 'vitest';
import { exportToMavisDrawFile, importMavisDrawFile, createMavisDrawBlob } from '../json';
import type { Diagram, MavisElement, RectangleElement, TextElement } from '@mavisdraw/types';

function makeDiagram(overrides?: Partial<Diagram>): Diagram {
  return {
    id: 'diagram-1',
    projectId: 'project-1',
    parentDiagramId: null,
    parentPortalId: null,
    title: 'Test Diagram',
    viewBackgroundColor: '#ffffff',
    gridEnabled: true,
    gridSize: 20,
    renderMode: 'clean',
    layers: [{ id: 'default', name: 'Layer 1', isVisible: true, isLocked: false, opacity: 100, order: 0 }],
    createdBy: 'test',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function makeRect(overrides?: Partial<RectangleElement>): RectangleElement {
  return {
    id: 'rect-1',
    type: 'rectangle',
    diagramId: 'diagram-1',
    x: 10,
    y: 20,
    width: 100,
    height: 60,
    angle: 0,
    opacity: 100,
    strokeColor: '#000000',
    backgroundColor: '#ffffff',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    seed: 12345,
    renderMode: 'clean',
    layerId: 'default',
    groupIds: [],
    isLocked: false,
    isDeleted: false,
    boundElements: [],
    version: 1,
    updatedAt: 1000,
    roundness: 0,
    ...overrides,
  };
}

describe('exportToMavisDrawFile', () => {
  it('exports diagrams and elements', () => {
    const diagram = makeDiagram();
    const element = makeRect();
    const file = exportToMavisDrawFile([diagram], [element], 'diagram-1');

    expect(file.type).toBe('mavisdraw');
    expect(file.version).toBe(1);
    expect(file.scene.diagrams).toHaveLength(1);
    expect(file.scene.elements).toHaveLength(1);
    expect(file.scene.rootDiagramId).toBe('diagram-1');
  });

  it('filters soft-deleted elements', () => {
    const diagram = makeDiagram();
    const live = makeRect({ id: 'live' });
    const deleted = makeRect({ id: 'deleted', isDeleted: true });
    const file = exportToMavisDrawFile([diagram], [live, deleted], 'diagram-1');

    expect(file.scene.elements).toHaveLength(1);
    expect(file.scene.elements[0].id).toBe('live');
  });

  it('includes appState when provided', () => {
    const file = exportToMavisDrawFile([], [], 'root', {
      renderMode: 'sketchy',
      viewBackgroundColor: '#f0f0f0',
      gridEnabled: false,
      gridSize: 10,
    });

    expect(file.appState).toBeDefined();
    expect(file.appState!.renderMode).toBe('sketchy');
  });

  it('omits appState when not provided', () => {
    const file = exportToMavisDrawFile([], [], 'root');
    expect(file.appState).toBeUndefined();
  });

  it('handles empty elements array', () => {
    const diagram = makeDiagram();
    const file = exportToMavisDrawFile([diagram], [], 'diagram-1');
    expect(file.scene.elements).toHaveLength(0);
    expect(file.scene.diagrams).toHaveLength(1);
  });
});

describe('importMavisDrawFile', () => {
  it('round-trips export then import', () => {
    const diagram = makeDiagram();
    const element = makeRect();
    const file = exportToMavisDrawFile([diagram], [element], 'diagram-1');
    const json = JSON.stringify(file);

    const result = importMavisDrawFile(json);
    expect(result.diagrams).toHaveLength(1);
    expect(result.elements).toHaveLength(1);
    expect(result.rootDiagramId).toBe('diagram-1');
    expect(result.elements[0].id).toBe('rect-1');
  });

  it('throws on invalid JSON', () => {
    expect(() => importMavisDrawFile('not json')).toThrow('Invalid JSON');
  });

  it('throws on wrong type field', () => {
    const json = JSON.stringify({ type: 'excalidraw', version: 1, scene: {} });
    expect(() => importMavisDrawFile(json)).toThrow('expected type "mavisdraw"');
  });

  it('throws on unsupported version', () => {
    const json = JSON.stringify({ type: 'mavisdraw', version: 999, scene: {} });
    expect(() => importMavisDrawFile(json)).toThrow('Unsupported .mavisdraw file version');
  });

  it('throws on missing scene', () => {
    const json = JSON.stringify({ type: 'mavisdraw', version: 1 });
    expect(() => importMavisDrawFile(json)).toThrow('missing or invalid scene');
  });

  it('throws on missing rootDiagramId', () => {
    const json = JSON.stringify({
      type: 'mavisdraw',
      version: 1,
      scene: { diagrams: [], elements: [] },
    });
    expect(() => importMavisDrawFile(json)).toThrow('missing rootDiagramId');
  });

  it('preserves appState on round-trip', () => {
    const appState = {
      renderMode: 'sketchy' as const,
      viewBackgroundColor: '#f0f0f0',
      gridEnabled: false,
      gridSize: 10,
    };
    const file = exportToMavisDrawFile([], [], 'root', appState);
    const json = JSON.stringify(file);
    const result = importMavisDrawFile(json);
    expect(result.appState).toEqual(appState);
  });

  it('handles multiple diagrams', () => {
    const root = makeDiagram({ id: 'root' });
    const child = makeDiagram({ id: 'child', parentDiagramId: 'root' });
    const el1 = makeRect({ id: 'el1', diagramId: 'root' });
    const el2 = makeRect({ id: 'el2', diagramId: 'child' });
    const file = exportToMavisDrawFile([root, child], [el1, el2], 'root');
    const json = JSON.stringify(file);

    const result = importMavisDrawFile(json);
    expect(result.diagrams).toHaveLength(2);
    expect(result.elements).toHaveLength(2);
  });
});

describe('createMavisDrawBlob', () => {
  it('creates a Blob with correct type', () => {
    const file = exportToMavisDrawFile([], [], 'root');
    const blob = createMavisDrawBlob(file);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/json');
  });
});

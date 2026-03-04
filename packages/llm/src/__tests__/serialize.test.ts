import { describe, it, expect } from 'vitest';
import { serializeScene } from '../serialize';
import { deserializeScene } from '../deserialize';
import type { MavisDrawScene } from '@mavisdraw/types';
import type {
  RectangleElement,
  LinearElement,
  TextElement,
  PortalElement,
} from '@mavisdraw/types';

function makeBase(overrides: Record<string, unknown> = {}) {
  return {
    diagramId: 'root',
    angle: 0,
    opacity: 100,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'none' as const,
    strokeWidth: 2,
    strokeStyle: 'solid' as const,
    roughness: 1,
    seed: 1,
    renderMode: 'clean' as const,
    layerId: 'default',
    groupIds: [],
    isLocked: false,
    isDeleted: false,
    boundElements: [],
    version: 1,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeDiagram(id: string, title: string, parentDiagramId: string | null = null) {
  return {
    id,
    projectId: 'proj-1',
    parentDiagramId,
    parentPortalId: null,
    title,
    viewBackgroundColor: '#fff',
    gridEnabled: true,
    gridSize: 20,
    renderMode: 'clean' as const,
    layers: [],
    createdBy: 'test',
    createdAt: 1000,
    updatedAt: 1000,
  };
}

describe('serializeScene', () => {
  it('serializes a simple scene with shapes and connections', () => {
    const scene: MavisDrawScene = {
      rootDiagramId: 'root',
      diagrams: [makeDiagram('root', 'My App')],
      elements: [
        {
          ...makeBase(),
          id: 'rect-1',
          type: 'rectangle',
          x: 0, y: 0, width: 100, height: 50,
          roundness: 8,
          boundElements: [{ id: 'text-1', type: 'text' }],
        } as RectangleElement,
        {
          ...makeBase(),
          id: 'text-1',
          type: 'text',
          x: 10, y: 10, width: 80, height: 30,
          text: 'API Gateway',
          fontSize: 16,
          fontFamily: 'sans-serif',
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: 'rect-1',
          lineHeight: 1.25,
        } as TextElement,
        {
          ...makeBase(),
          id: 'rect-2',
          type: 'rectangle',
          x: 200, y: 0, width: 100, height: 50,
          roundness: 8,
          boundElements: [{ id: 'text-2', type: 'text' }],
        } as RectangleElement,
        {
          ...makeBase(),
          id: 'text-2',
          type: 'text',
          x: 210, y: 10, width: 80, height: 30,
          text: 'Auth Service',
          fontSize: 16,
          fontFamily: 'sans-serif',
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: 'rect-2',
          lineHeight: 1.25,
        } as TextElement,
        {
          ...makeBase(),
          id: 'arrow-1',
          type: 'arrow',
          x: 100, y: 25, width: 100, height: 0,
          points: [[0, 0], [100, 0]],
          startBinding: { elementId: 'rect-1', gap: 5 },
          endBinding: { elementId: 'rect-2', gap: 5 },
          routingMode: 'straight',
          startArrowhead: 'none',
          endArrowhead: 'arrow',
        } as LinearElement,
      ],
    };

    const result = serializeScene(scene, 'My App');

    expect(result).toContain('# Architecture: My App');
    expect(result).toContain('[rectangle] "API Gateway"');
    expect(result).toContain('[rectangle] "Auth Service"');
    expect(result).toContain('"API Gateway" --> "Auth Service"');
  });

  it('includes GitHub links on portals', () => {
    const scene: MavisDrawScene = {
      rootDiagramId: 'root',
      diagrams: [makeDiagram('root', 'System')],
      elements: [
        {
          ...makeBase(),
          id: 'portal-1',
          type: 'portal',
          x: 0, y: 0, width: 200, height: 100,
          targetDiagramId: '',
          label: 'User Service',
          thumbnailDataUrl: null,
          portalStyle: 'card',
          githubLink: {
            owner: 'acme',
            repo: 'user-service',
            path: 'src/',
            ref: 'main',
          },
        } as PortalElement,
      ],
    };

    const result = serializeScene(scene);
    expect(result).toContain('[portal] "User Service"');
    expect(result).toContain('github: acme/user-service @ src/');
  });

  it('excludes deleted elements', () => {
    const scene: MavisDrawScene = {
      rootDiagramId: 'root',
      diagrams: [makeDiagram('root', 'Test')],
      elements: [
        {
          ...makeBase({ isDeleted: true }),
          id: 'rect-1',
          type: 'rectangle',
          x: 0, y: 0, width: 100, height: 50,
          roundness: 8,
          boundElements: [{ id: 'text-1', type: 'text' }],
        } as RectangleElement,
        {
          ...makeBase({ isDeleted: true }),
          id: 'text-1',
          type: 'text',
          x: 0, y: 0, width: 80, height: 30,
          text: 'Deleted Box',
          fontSize: 16,
          fontFamily: 'sans-serif',
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: 'rect-1',
          lineHeight: 1.25,
        } as TextElement,
      ],
    };

    const result = serializeScene(scene);
    expect(result).not.toContain('Deleted Box');
  });

  it('serializes nested diagrams via portals', () => {
    const scene: MavisDrawScene = {
      rootDiagramId: 'root',
      diagrams: [
        makeDiagram('root', 'Top Level'),
        makeDiagram('child', 'User Service Detail', 'root'),
      ],
      elements: [
        {
          ...makeBase(),
          id: 'portal-1',
          type: 'portal',
          x: 0, y: 0, width: 200, height: 100,
          targetDiagramId: 'child',
          label: 'User Service',
          thumbnailDataUrl: null,
          portalStyle: 'card',
          githubLink: null,
        } as PortalElement,
        {
          ...makeBase({ diagramId: 'child' }),
          id: 'rect-child',
          type: 'rectangle',
          x: 0, y: 0, width: 100, height: 50,
          roundness: 8,
          boundElements: [{ id: 'text-child', type: 'text' }],
        } as RectangleElement,
        {
          ...makeBase({ diagramId: 'child' }),
          id: 'text-child',
          type: 'text',
          x: 0, y: 0, width: 80, height: 30,
          text: 'UserController',
          fontSize: 16,
          fontFamily: 'sans-serif',
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: 'rect-child',
          lineHeight: 1.25,
        } as TextElement,
      ],
    };

    const result = serializeScene(scene);
    expect(result).toContain('User Service Detail');
    expect(result).toContain('[rectangle] "UserController"');
  });

  it('serializes an empty scene', () => {
    const scene: MavisDrawScene = {
      rootDiagramId: 'root',
      diagrams: [makeDiagram('root', 'Empty')],
      elements: [],
    };

    const result = serializeScene(scene, 'Empty');
    expect(result).toContain('# Architecture: Empty');
    expect(result).not.toContain('[rectangle]');
    expect(result).not.toContain('-->');
  });

  it('serializes portal with both nested diagram and GitHub link', () => {
    const scene: MavisDrawScene = {
      rootDiagramId: 'root',
      diagrams: [
        makeDiagram('root', 'System'),
        makeDiagram('child', 'User Service Detail', 'root'),
      ],
      elements: [
        {
          ...makeBase(),
          id: 'portal-1',
          type: 'portal',
          x: 0, y: 0, width: 200, height: 100,
          targetDiagramId: 'child',
          label: 'User Service',
          thumbnailDataUrl: null,
          portalStyle: 'card',
          githubLink: {
            owner: 'acme',
            repo: 'user-service',
            path: 'src/',
            ref: 'main',
          },
        } as PortalElement,
        {
          ...makeBase({ diagramId: 'child' }),
          id: 'rect-child',
          type: 'rectangle',
          x: 0, y: 0, width: 100, height: 50,
          roundness: 8,
          boundElements: [{ id: 'text-child', type: 'text' }],
        } as RectangleElement,
        {
          ...makeBase({ diagramId: 'child' }),
          id: 'text-child',
          type: 'text',
          x: 0, y: 0, width: 80, height: 30,
          text: 'Controller',
          fontSize: 16,
          fontFamily: 'sans-serif',
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: 'rect-child',
          lineHeight: 1.25,
        } as TextElement,
      ],
    };

    const result = serializeScene(scene);
    expect(result).toContain('[portal] "User Service"');
    expect(result).toContain('github: acme/user-service @ src/');
    expect(result).toContain('User Service Detail');
    expect(result).toContain('[rectangle] "Controller"');
  });

  it('shows non-default ref in GitHub link', () => {
    const scene: MavisDrawScene = {
      rootDiagramId: 'root',
      diagrams: [makeDiagram('root', 'System')],
      elements: [
        {
          ...makeBase(),
          id: 'portal-1',
          type: 'portal',
          x: 0, y: 0, width: 200, height: 100,
          targetDiagramId: '',
          label: 'Dev Service',
          thumbnailDataUrl: null,
          portalStyle: 'card',
          githubLink: {
            owner: 'acme',
            repo: 'dev-service',
            path: '',
            ref: 'develop',
          },
        } as PortalElement,
      ],
    };

    const result = serializeScene(scene);
    expect(result).toContain('develop');
  });

  it('serializes arrow labels in bracket syntax', () => {
    const scene: MavisDrawScene = {
      rootDiagramId: 'root',
      diagrams: [makeDiagram('root', 'App')],
      elements: [
        {
          ...makeBase(),
          id: 'rect-1',
          type: 'rectangle',
          x: 0, y: 0, width: 100, height: 50,
          roundness: 8,
          boundElements: [{ id: 'text-1', type: 'text' }],
        } as RectangleElement,
        {
          ...makeBase(),
          id: 'text-1',
          type: 'text',
          x: 10, y: 10, width: 80, height: 30,
          text: 'Service A',
          fontSize: 16,
          fontFamily: 'sans-serif',
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: 'rect-1',
          lineHeight: 1.25,
        } as TextElement,
        {
          ...makeBase(),
          id: 'rect-2',
          type: 'rectangle',
          x: 200, y: 0, width: 100, height: 50,
          roundness: 8,
          boundElements: [{ id: 'text-2', type: 'text' }],
        } as RectangleElement,
        {
          ...makeBase(),
          id: 'text-2',
          type: 'text',
          x: 210, y: 10, width: 80, height: 30,
          text: 'Service B',
          fontSize: 16,
          fontFamily: 'sans-serif',
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: 'rect-2',
          lineHeight: 1.25,
        } as TextElement,
        {
          ...makeBase(),
          id: 'arrow-1',
          type: 'arrow',
          x: 100, y: 25, width: 100, height: 0,
          points: [[0, 0], [100, 0]],
          startBinding: { elementId: 'rect-1', gap: 5 },
          endBinding: { elementId: 'rect-2', gap: 5 },
          routingMode: 'straight',
          startArrowhead: 'none',
          endArrowhead: 'arrow',
          boundElements: [{ id: 'arrow-label', type: 'text' }],
        } as LinearElement,
        {
          ...makeBase(),
          id: 'arrow-label',
          type: 'text',
          x: 140, y: 15, width: 40, height: 20,
          text: 'gRPC',
          fontSize: 14,
          fontFamily: 'sans-serif',
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: 'arrow-1',
          lineHeight: 1.25,
        } as TextElement,
      ],
    };

    const result = serializeScene(scene, 'App');
    expect(result).toContain('[gRPC]');
    expect(result).toContain('"Service A"');
    expect(result).toContain('"Service B"');
  });
});

describe('deserializeScene', () => {
  it('round-trips a simple scene', () => {
    const markdown = `# Architecture: Test App

### Elements

- [rectangle] "API Gateway" → connected to "Database"
- [rectangle] "Database"

### Connections

- "API Gateway" --> "Database"
`;

    const scene = deserializeScene(markdown);
    expect(scene.diagrams).toHaveLength(1);
    expect(scene.elements.length).toBeGreaterThanOrEqual(2);

    // Verify re-serialization preserves key info
    const reserialized = serializeScene(scene, 'Test App');
    expect(reserialized).toContain('API Gateway');
    expect(reserialized).toContain('Database');
  });

  it('parses portal elements with GitHub links', () => {
    const markdown = `# Architecture: My System

### Elements

- [portal] "User Service" → drills into "User Detail"
  - github: acme/user-service @ src/ (develop)
`;

    const scene = deserializeScene(markdown);
    const portal = scene.elements.find((e) => e.type === 'portal') as PortalElement | undefined;
    expect(portal).toBeDefined();
    expect(portal!.label).toBe('User Service');
    expect(portal!.githubLink).toEqual({
      owner: 'acme',
      repo: 'user-service',
      path: 'src/',
      ref: 'develop',
    });
  });

  it('parses connections with labels', () => {
    const markdown = `# Architecture: Test

### Elements

- [rectangle] "A"
- [rectangle] "B"

### Connections

- "A" -->[REST] "B"
`;

    const scene = deserializeScene(markdown);
    const arrows = scene.elements.filter((e) => e.type === 'arrow');
    expect(arrows.length).toBeGreaterThanOrEqual(1);

    // Check that the arrow has a bound text label
    const arrowTexts = scene.elements.filter(
      (e) => e.type === 'text' && (e as TextElement).containerId != null,
    );
    const restLabel = arrowTexts.find((e) => (e as TextElement).text === 'REST');
    expect(restLabel).toBeDefined();
  });
});

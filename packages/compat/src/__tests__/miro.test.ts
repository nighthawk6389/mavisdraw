import { describe, it, expect } from 'vitest';
import { exportToMiro } from '../miro/export';
import type {
  RectangleElement,
  EllipseElement,
  DiamondElement,
  LinearElement,
  TextElement,
  PortalElement,
} from '@mavisdraw/types';
import type { MiroShapeItem, MiroConnectorItem, MiroTextItem } from '../miro/types';

function makeBase(overrides = {}) {
  return {
    diagramId: 'diag-1',
    angle: 0,
    opacity: 100,
    strokeColor: '#000000',
    backgroundColor: '#ffffff',
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
    ...overrides,
  };
}

describe('exportToMiro', () => {
  it('converts rectangle with center-based position', () => {
    const rect: RectangleElement = {
      ...makeBase(),
      id: 'rect-1',
      type: 'rectangle',
      x: 100,
      y: 200,
      width: 120,
      height: 60,
      roundness: 0,
    };

    const result = exportToMiro([rect]);
    expect(result.items).toHaveLength(1);

    const item = result.items[0] as MiroShapeItem;
    expect(item.type).toBe('shape');
    expect(item.data.shape).toBe('rectangle');
    // Center-based: x + width/2, y + height/2
    expect(item.position.x).toBe(160); // 100 + 60
    expect(item.position.y).toBe(230); // 200 + 30
    expect(item.geometry.width).toBe(120);
    expect(item.geometry.height).toBe(60);
  });

  it('maps rounded rectangle to round_rectangle', () => {
    const rect: RectangleElement = {
      ...makeBase(),
      id: 'rect-2',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      roundness: 8,
    };

    const result = exportToMiro([rect]);
    const item = result.items[0] as MiroShapeItem;
    expect(item.data.shape).toBe('round_rectangle');
  });

  it('maps ellipse to circle', () => {
    const ellipse: EllipseElement = {
      ...makeBase(),
      id: 'ell-1',
      type: 'ellipse',
      x: 0,
      y: 0,
      width: 80,
      height: 80,
    };

    const result = exportToMiro([ellipse]);
    const item = result.items[0] as MiroShapeItem;
    expect(item.data.shape).toBe('circle');
  });

  it('maps diamond to rhombus', () => {
    const diamond: DiamondElement = {
      ...makeBase(),
      id: 'dia-1',
      type: 'diamond',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    };

    const result = exportToMiro([diamond]);
    const item = result.items[0] as MiroShapeItem;
    expect(item.data.shape).toBe('rhombus');
  });

  it('converts arrow to connector with bindings', () => {
    const arrow: LinearElement = {
      ...makeBase(),
      id: 'arrow-1',
      type: 'arrow',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [
        [0, 0],
        [100, 50],
      ],
      startBinding: { elementId: 'rect-1', gap: 5 },
      endBinding: { elementId: 'rect-2', gap: 5 },
      routingMode: 'curved',
      startArrowhead: 'none',
      endArrowhead: 'arrow',
    };

    const result = exportToMiro([arrow]);
    const item = result.items[0] as MiroConnectorItem;
    expect(item.type).toBe('connector');
    expect(item.data.shape).toBe('curved');
    expect(item.startItem).toEqual({ id: 'rect-1' });
    expect(item.endItem).toEqual({ id: 'rect-2' });
    expect(item.style.startStrokeCap).toBe('none');
    expect(item.style.endStrokeCap).toBe('arrow');
  });

  it('converts text items', () => {
    const text: TextElement = {
      ...makeBase(),
      id: 'text-1',
      type: 'text',
      x: 50,
      y: 100,
      width: 200,
      height: 40,
      text: 'Hello World',
      fontSize: 16,
      fontFamily: 'monospace',
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: null,
      lineHeight: 1.25,
    };

    const result = exportToMiro([text]);
    const item = result.items[0] as MiroTextItem;
    expect(item.type).toBe('text');
    expect(item.data.content).toContain('Hello World');
    expect(item.style.fontFamily).toBe('monospace');
    expect(item.position.x).toBe(150); // 50 + 100
    expect(item.position.y).toBe(120); // 100 + 20
  });

  it('skips portal elements', () => {
    const portal: PortalElement = {
      ...makeBase(),
      id: 'portal-1',
      type: 'portal',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      targetDiagramId: 'child',
      label: 'Sub',
      thumbnailDataUrl: null,
      portalStyle: 'card',
    };

    const result = exportToMiro([portal]);
    expect(result.items).toHaveLength(0);
  });

  it('skips deleted elements', () => {
    const rect: RectangleElement = {
      ...makeBase({ isDeleted: true }),
      id: 'del-1',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      roundness: 0,
    };

    const result = exportToMiro([rect]);
    expect(result.items).toHaveLength(0);
  });

  it('skips bound text elements', () => {
    const text: TextElement = {
      ...makeBase(),
      id: 'bound-text',
      type: 'text',
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      text: 'Bound',
      fontSize: 14,
      fontFamily: 'sans-serif',
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: 'rect-1', // This is bound
      lineHeight: 1.25,
    };

    const result = exportToMiro([text]);
    expect(result.items).toHaveLength(0);
  });

  it('converts rotation from radians to degrees', () => {
    const rect: RectangleElement = {
      ...makeBase({ angle: Math.PI / 4 }), // 45 degrees
      id: 'rot-1',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      roundness: 0,
    };

    const result = exportToMiro([rect]);
    const item = result.items[0] as MiroShapeItem;
    expect(item.geometry.rotation).toBeCloseTo(45, 1);
  });

  it('maps stroke styles correctly', () => {
    const rect: RectangleElement = {
      ...makeBase({ strokeStyle: 'dashed' }),
      id: 'dashed-1',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      roundness: 0,
    };

    const result = exportToMiro([rect]);
    const item = result.items[0] as MiroShapeItem;
    expect(item.style.borderStyle).toBe('dashed');
  });

  it('exports board with correct type and version', () => {
    const result = exportToMiro([]);
    expect(result.type).toBe('miro-board');
    expect(result.version).toBe(1);
    expect(result.items).toHaveLength(0);
  });
});

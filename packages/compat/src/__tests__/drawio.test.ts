import { describe, it, expect } from 'vitest';
import { importFromDrawio } from '../drawio/import';
import { exportToDrawio } from '../drawio/export';
import {
  parseDrawioStyle,
  inferElementType,
  inferRoutingMode,
  mapArrowhead,
} from '../drawio/mapping';
import type { RectangleElement, LinearElement, Diagram } from '@mavisdraw/types';

describe('parseDrawioStyle', () => {
  it('parses key=value pairs', () => {
    const style = parseDrawioStyle('rounded=0;whiteSpace=wrap;html=1;');
    expect(style.get('rounded')).toBe('0');
    expect(style.get('whiteSpace')).toBe('wrap');
    expect(style.get('html')).toBe('1');
  });

  it('parses shape identifier token', () => {
    const style = parseDrawioStyle('ellipse;whiteSpace=wrap;html=1;');
    expect(style.get('_shape')).toBe('ellipse');
    expect(style.get('html')).toBe('1');
  });

  it('handles empty string', () => {
    const style = parseDrawioStyle('');
    expect(style.size).toBe(0);
  });
});

describe('inferElementType', () => {
  it('detects ellipse', () => {
    const style = parseDrawioStyle('ellipse;whiteSpace=wrap;');
    expect(inferElementType(style, false)).toBe('ellipse');
  });

  it('detects diamond (rhombus)', () => {
    const style = parseDrawioStyle('rhombus;whiteSpace=wrap;');
    expect(inferElementType(style, false)).toBe('diamond');
  });

  it('defaults to rectangle for vertex', () => {
    const style = parseDrawioStyle('rounded=0;whiteSpace=wrap;html=1;');
    expect(inferElementType(style, false)).toBe('rectangle');
  });

  it('returns arrow for edge', () => {
    const style = parseDrawioStyle('edgeStyle=orthogonalEdgeStyle;');
    expect(inferElementType(style, true)).toBe('arrow');
  });
});

describe('inferRoutingMode', () => {
  it('detects orthogonal (elbow)', () => {
    const style = parseDrawioStyle('edgeStyle=orthogonalEdgeStyle;');
    expect(inferRoutingMode(style)).toBe('elbow');
  });

  it('detects curved', () => {
    const style = parseDrawioStyle('curved=1;');
    expect(inferRoutingMode(style)).toBe('curved');
  });

  it('defaults to straight', () => {
    const style = parseDrawioStyle('html=1;');
    expect(inferRoutingMode(style)).toBe('straight');
  });
});

describe('mapArrowhead', () => {
  it('maps block to triangle', () => {
    expect(mapArrowhead('block')).toBe('triangle');
  });
  it('maps classic to arrow', () => {
    expect(mapArrowhead('classic')).toBe('arrow');
  });
  it('maps oval to dot', () => {
    expect(mapArrowhead('oval')).toBe('dot');
  });
  it('maps none to none', () => {
    expect(mapArrowhead('none')).toBe('none');
  });
  it('defaults to arrow for unknown', () => {
    expect(mapArrowhead('unknown')).toBe('arrow');
  });
});

describe('importFromDrawio', () => {
  const simpleXml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="test">
  <diagram name="Page-1" id="page1">
    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" background="#ffffff">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="rect-1" value="Hello" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
          <mxGeometry x="100" y="200" width="120" height="60" as="geometry" />
        </mxCell>
        <mxCell id="ellipse-1" value="" style="ellipse;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="300" y="200" width="80" height="80" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

  it('parses shapes from XML', () => {
    const result = importFromDrawio(simpleXml);
    expect(result.diagrams).toHaveLength(1);
    // rect + text bound to rect + ellipse = 3 elements
    expect(result.elements.length).toBeGreaterThanOrEqual(2);
  });

  it('creates rectangle with correct position', () => {
    const result = importFromDrawio(simpleXml);
    const rect = result.elements.find(
      (el) => el.type === 'rectangle',
    ) as RectangleElement;
    expect(rect).toBeDefined();
    expect(rect.x).toBe(100);
    expect(rect.y).toBe(200);
    expect(rect.width).toBe(120);
    expect(rect.height).toBe(60);
  });

  it('creates bound text element for cells with value', () => {
    const result = importFromDrawio(simpleXml);
    const textEls = result.elements.filter((el) => el.type === 'text');
    expect(textEls.length).toBeGreaterThanOrEqual(1);
    const boundText = textEls[0] as import('@mavisdraw/types').TextElement;
    expect(boundText.text).toBe('Hello');
    expect(boundText.containerId).toBeTruthy();
  });

  it('extracts colors from style', () => {
    const result = importFromDrawio(simpleXml);
    const rect = result.elements.find((el) => el.type === 'rectangle');
    expect(rect?.strokeColor).toBe('#6c8ebf');
    expect(rect?.backgroundColor).toBe('#dae8fc');
  });

  it('handles edges (arrows)', () => {
    const xmlWithEdge = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="test">
  <diagram name="Page-1" id="page1">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="src" value="A" style="rounded=0;" vertex="1" parent="1">
          <mxGeometry x="0" y="0" width="100" height="50" as="geometry" />
        </mxCell>
        <mxCell id="tgt" value="B" style="rounded=0;" vertex="1" parent="1">
          <mxGeometry x="200" y="0" width="100" height="50" as="geometry" />
        </mxCell>
        <mxCell id="edge-1" value="" style="edgeStyle=orthogonalEdgeStyle;endArrow=block;" edge="1" parent="1" source="src" target="tgt">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

    const result = importFromDrawio(xmlWithEdge);
    const arrow = result.elements.find((el) => el.type === 'arrow') as LinearElement;
    expect(arrow).toBeDefined();
    expect(arrow.routingMode).toBe('elbow');
    expect(arrow.endArrowhead).toBe('triangle');
  });

  it('handles multi-page diagrams', () => {
    const multiPageXml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="test">
  <diagram name="Page 1" id="p1">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
  <diagram name="Page 2" id="p2">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

    const result = importFromDrawio(multiPageXml);
    expect(result.diagrams).toHaveLength(2);
    expect(result.diagrams[0].title).toBe('Page 1');
    expect(result.diagrams[1].title).toBe('Page 2');
  });

  it('throws on malformed XML', () => {
    expect(() => importFromDrawio('<not-valid')).toThrow();
  });
});

describe('exportToDrawio', () => {
  it('exports a rectangle as mxCell', () => {
    const diagram: Diagram = {
      id: 'diag-1',
      projectId: 'proj',
      parentDiagramId: null,
      parentPortalId: null,
      title: 'Test',
      viewBackgroundColor: '#ffffff',
      gridEnabled: true,
      gridSize: 10,
      renderMode: 'clean',
      layers: [],
      createdBy: 'test',
      createdAt: 1000,
      updatedAt: 2000,
    };

    const rect: RectangleElement = {
      id: 'rect-1',
      type: 'rectangle',
      diagramId: 'diag-1',
      x: 50,
      y: 100,
      width: 120,
      height: 60,
      angle: 0,
      opacity: 100,
      strokeColor: '#000',
      backgroundColor: '#fff',
      fillStyle: 'solid',
      strokeWidth: 2,
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
      roundness: 0,
    };

    const xml = exportToDrawio([diagram], new Map([['diag-1', [rect]]]));
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<mxfile');
    expect(xml).toContain('vertex="1"');
    expect(xml).toContain('width="120"');
    expect(xml).toContain('height="60"');
  });

  it('produces parseable XML', () => {
    const diagram: Diagram = {
      id: 'diag-1',
      projectId: 'proj',
      parentDiagramId: null,
      parentPortalId: null,
      title: 'Round Trip',
      viewBackgroundColor: '#ffffff',
      gridEnabled: true,
      gridSize: 10,
      renderMode: 'clean',
      layers: [],
      createdBy: 'test',
      createdAt: 1000,
      updatedAt: 2000,
    };

    const rect: RectangleElement = {
      id: 'rect-1',
      type: 'rectangle',
      diagramId: 'diag-1',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      angle: 0,
      opacity: 100,
      strokeColor: '#000',
      backgroundColor: '#dae8fc',
      fillStyle: 'solid',
      strokeWidth: 2,
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
      roundness: 4,
    };

    const xml = exportToDrawio([diagram], new Map([['diag-1', [rect]]]));

    // Parse the output XML
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const error = doc.querySelector('parsererror');
    expect(error).toBeNull();

    const cells = doc.querySelectorAll('mxCell');
    expect(cells.length).toBeGreaterThanOrEqual(3); // id=0, id=1, rect-1
  });
});

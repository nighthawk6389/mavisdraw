import { describe, it, expect } from 'vitest';
import type { Diagram, MavisElement } from '@mavisdraw/types';
import { exportToDrawio } from '../drawio/export';
import { importFromDrawio } from '../drawio/import';
import { exportToExcalidraw } from '../excalidraw/export';
import { exportToMiro } from '../miro/export';
import type { MiroShapeItem } from '../miro/types';

const base = {
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
};
const db = {
  ...base,
  id: 'db',
  type: 'cylinder',
  x: 0,
  y: 0,
  width: 120,
  height: 100,
} as MavisElement;
const queue = {
  ...base,
  id: 'q',
  type: 'queue',
  x: 200,
  y: 0,
  width: 180,
  height: 70,
} as MavisElement;
const diagram = {
  id: 'diag-1',
  projectId: 'p',
  parentDiagramId: null,
  parentPortalId: null,
  title: 'Shop',
  viewBackgroundColor: '#ffffff',
  gridEnabled: false,
  gridSize: 20,
  renderMode: 'clean',
  layers: [],
  createdBy: 'u',
  createdAt: 1,
  updatedAt: 1,
} as unknown as Diagram;

describe('datastores and queues in other tools', () => {
  it('go to draw.io as its cylinder (on its side for a queue), and come back', () => {
    const xml = exportToDrawio([diagram], new Map([['diag-1', [db, queue]]]));
    expect(xml).toContain('shape=cylinder3');
    expect(xml).toContain('direction=south');
    const back = importFromDrawio(xml);
    expect(back.elements.map((e) => e.type).sort()).toEqual(['cylinder', 'queue']);
  });

  it('read draw.io’s own cylinders', () => {
    const xml = `<mxfile><diagram id="d" name="Page-1"><mxGraphModel><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="c" value="Orders" style="shape=cylinder3;whiteSpace=wrap;html=1;" vertex="1" parent="1">
        <mxGeometry x="10" y="10" width="60" height="80" as="geometry"/>
      </mxCell>
    </root></mxGraphModel></diagram></mxfile>`;
    expect(importFromDrawio(xml).elements.some((e) => e.type === 'cylinder')).toBe(true);
  });

  it('go to Excalidraw as rounded boxes (it has no cylinders), not dropped', () => {
    const file = exportToExcalidraw([db, queue]);
    expect(file.elements.map((e) => e.type)).toEqual(['rectangle', 'rectangle']);
  });

  it('go to Miro as its “can” shape', () => {
    const board = exportToMiro([db, queue]);
    const shapes = board.items.filter((i) => i.type === 'shape') as MiroShapeItem[];
    expect(shapes.map((s) => s.data.shape)).toEqual(['can', 'can']);
  });
});

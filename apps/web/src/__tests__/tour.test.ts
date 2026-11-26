import { describe, it, expect } from 'vitest';
import type { Diagram, MavisElement } from '@mavisdraw/types';
import { useElementsStore } from '../stores/elementsStore';
import { componentNames, generateTour } from '../present/tour';

const diagram = (id: string, title: string, parent: string | null = null): Diagram => ({
  id,
  projectId: 'p',
  parentDiagramId: parent,
  parentPortalId: null,
  title,
  viewBackgroundColor: '#fff',
  gridEnabled: false,
  gridSize: 20,
  renderMode: 'clean',
  layers: [],
  createdBy: 'u',
  createdAt: 0,
  updatedAt: 0,
});

let n = 0;
function el(
  type: 'rectangle' | 'portal' | 'text',
  diagramId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    ...useElementsStore.getState().createElement(type, diagramId, 0, 0, 100, 50),
    id: `el${++n}`,
    ...extra,
  } as MavisElement;
}

function labelled(diagramId: string, name: string, x: number, y: number): MavisElement[] {
  const box = el('rectangle', diagramId, { x, y });
  return [box, el('text', diagramId, { containerId: box.id, text: name })];
}

describe('tour generation', () => {
  it('walks every level top-down, portals in reading order', () => {
    const diagrams = new Map([
      ['root', diagram('root', 'Shop')],
      ['pay', diagram('pay', 'Payments', 'root')],
      ['fraud', diagram('fraud', 'Fraud checks', 'pay')],
      ['ship', diagram('ship', 'Shipping', 'root')],
    ]);
    const elements = [
      ...labelled('root', 'Web App', 0, 0),
      el('portal', 'root', { x: 600, y: 0, targetDiagramId: 'ship', label: 'Shipping' }),
      el('portal', 'root', { x: 300, y: 0, targetDiagramId: 'pay', label: 'Payments' }),
      el('portal', 'pay', { x: 0, y: 0, targetDiagramId: 'fraud', label: 'Fraud checks' }),
      ...labelled('pay', 'Stripe', 300, 0),
      el('portal', 'root', { x: 900, y: 0, targetDiagramId: 'missing', label: 'Ghost' }),
    ];
    const stops = generateTour(diagrams, elements, 'root');
    expect(stops.map((s) => s.diagramId)).toEqual(['root', 'pay', 'fraud', 'ship']);
    expect(stops[0].title).toBe('Shop — overview');
    // A portal whose diagram is gone is still a named shape, but not a stop
    expect(stops[0].note).toBe(
      'Web App, Payments, Shipping, Ghost — Zooms into: Payments, Shipping',
    );
    expect(stops[1].note).toContain('Stripe');
    expect(stops.every((s) => s.viewport === null)).toBe(true);
    expect(new Set(stops.map((s) => s.id)).size).toBe(4);
  });

  it('names components left to right, row by row, skipping unlabelled shapes', () => {
    const elements = [
      ...labelled('d', 'Second row', 0, 300),
      ...labelled('d', 'B', 200, 0),
      ...labelled('d', 'A', 0, 10),
      el('rectangle', 'd', { x: 50, y: 50 }),
    ];
    expect(componentNames(elements, 'd')).toEqual(['A', 'B', 'Second row']);
  });

  it('never loops on a cycle of portals', () => {
    const diagrams = new Map([
      ['a', diagram('a', 'A')],
      ['b', diagram('b', 'B', 'a')],
    ]);
    const elements = [
      el('portal', 'a', { targetDiagramId: 'b', label: 'B' }),
      el('portal', 'b', { targetDiagramId: 'a', label: 'A' }),
    ];
    expect(generateTour(diagrams, elements, 'a').map((s) => s.diagramId)).toEqual(['a', 'b']);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Diagram, PortalElement, TextElement } from '@mavisdraw/types';
import { parseMermaidFlowchart } from '@mavisdraw/compat';
import { TEMPLATES, SAMPLE_TEMPLATE_ID, findTemplate } from '../templates/templates';
import {
  activeDiagramIsEmpty,
  insertTemplate,
  parseStartupAction,
  withoutStartupParams,
} from '../templates/startup';
import { useElementsStore } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';

// Nested diagrams are created on the server too; not under test here
vi.mock('../services/diagramSync', () => ({ registerNewDiagram: vi.fn() }));

const ROOT = 'root';

function resetStores() {
  useElementsStore.setState({
    elements: new Map(),
    history: [],
    historyIndex: -1,
    clipboard: null,
  });
  const root: Diagram = {
    id: ROOT,
    projectId: 'p1',
    parentDiagramId: null,
    parentPortalId: null,
    title: 'Root',
    viewBackgroundColor: '#fff',
    gridEnabled: true,
    gridSize: 20,
    renderMode: 'clean',
    layers: [],
    createdBy: 'u1',
    createdAt: 1,
    updatedAt: 1,
  };
  useDiagramStore.setState({
    diagrams: new Map([[ROOT, root]]),
    activeDiagramId: ROOT,
    diagramPath: [ROOT],
  });
}

describe('templates', () => {
  it('have unique ids and names, and the sample exists', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    expect(new Set(TEMPLATES.map((t) => t.name)).size).toBe(TEMPLATES.length);
    expect(findTemplate(SAMPLE_TEMPLATE_ID)).toBeDefined();
    expect(findTemplate('nope')).toBeUndefined();
  });

  for (const template of TEMPLATES) {
    it(`“${template.name}” is a nested, connected map`, () => {
      const graph = parseMermaidFlowchart(template.mermaid);
      expect(graph.nodes.size).toBeGreaterThanOrEqual(6);
      expect(graph.subgraphs.size).toBeGreaterThanOrEqual(1);
      expect(graph.edges.length).toBeGreaterThanOrEqual(5);
      // Every link joins things that exist (a typo would silently add a box)
      for (const edge of graph.edges) {
        for (const end of [edge.from, edge.to]) {
          expect(graph.nodes.has(end) || graph.subgraphs.has(end), `${template.id}: ${end}`).toBe(
            true,
          );
        }
      }
      for (const node of graph.nodes.values()) {
        expect(node.label, `${template.id}: ${node.id} has a real label`).not.toBe(node.id);
      }
    });
  }
});

describe('starting a project from a template', () => {
  beforeEach(resetStores);

  it('reads ?template= and ?start=repo, ignoring unknown templates', () => {
    expect(parseStartupAction('?template=saas')).toMatchObject({
      kind: 'template',
      template: { id: 'saas' },
    });
    expect(parseStartupAction('?start=repo')).toEqual({ kind: 'map-repo' });
    expect(parseStartupAction('?template=../../etc')).toBeNull();
    expect(parseStartupAction('')).toBeNull();
  });

  it('drops only its own parameters from the address', () => {
    expect(withoutStartupParams('?template=c4&thread=t1')).toBe('?thread=t1');
    expect(withoutStartupParams('?start=repo')).toBe('');
  });

  it('lays the sample out as a three-level map', async () => {
    expect(activeDiagramIsEmpty()).toBe(true);
    const result = await insertTemplate(findTemplate('c4')!);
    expect(result.diagrams).toBe(2);
    expect(activeDiagramIsEmpty()).toBe(false);

    const els = Array.from(useElementsStore.getState().elements.values());
    const shop = els.find(
      (e) => e.type === 'portal' && (e as PortalElement).label === 'Online Shop',
    ) as PortalElement;
    expect(shop.diagramId).toBe(ROOT);
    // One level in: the containers, and the API as a nested system of its own
    const inShop = els.filter((e) => e.diagramId === shop.targetDiagramId);
    const api = inShop.find(
      (e) => e.type === 'portal' && (e as PortalElement).label === 'API',
    ) as PortalElement;
    expect(api).toBeDefined();
    const modules = els
      .filter((e) => e.diagramId === api.targetDiagramId && e.type === 'text')
      .map((e) => (e as TextElement).text)
      .sort();
    expect(modules).toEqual(['Catalog module', 'Checkout module', 'Orders module']);
  });
});

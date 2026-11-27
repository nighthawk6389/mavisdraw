import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Diagram, LinearElement, MavisElement, PortalElement, TextElement } from '@mavisdraw/types';
import { parseMermaidFlowchart } from '@mavisdraw/compat';
import { useElementsStore } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';
import { linearMidpoint } from '../stores/elementBindings';
import { findDirtyDiagrams, recordSaved, resetSaveTracking } from '../services/saveTracker';
import { computeLayout, tidyUpDiagram } from '../layout/autoLayout';
import { importMermaidGraph } from '../import/mermaidImport';
import { applyProposal } from '../components/agent/applyProposal';

// Creating nested diagrams also creates them on the server; not under test here
const saveRelationship = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  apiSaveRelationship: saveRelationship,
}));

vi.mock('../services/diagramSync', () => ({
  registerNewDiagram: vi.fn(),
}));

const ROOT = 'root-diagram';

function resetStores() {
  useElementsStore.setState({ elements: new Map(), history: [], historyIndex: -1, clipboard: null });
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
  useDiagramStore.setState({ diagrams: new Map([[ROOT, root]]), activeDiagramId: ROOT, diagramPath: [ROOT] });
  resetSaveTracking();
}

const store = () => useElementsStore.getState();
const all = () => Array.from(store().elements.values()).filter((e) => !e.isDeleted);
const textOf = (el: MavisElement) => (el as TextElement).text;

function labelled(diagramId: string): Map<string, MavisElement> {
  const els = Array.from(store().elements.values()).filter((e) => e.diagramId === diagramId && !e.isDeleted);
  const out = new Map<string, MavisElement>();
  for (const t of els) {
    if (t.type === 'text' && t.containerId) out.set(textOf(t), store().elements.get(t.containerId)!);
  }
  for (const p of els) if (p.type === 'portal') out.set((p as PortalElement).label, p);
  return out;
}

describe('connector labels', () => {
  beforeEach(resetStores);

  it('computes the midpoint along a polyline', () => {
    const arrow = store().createElement('arrow', ROOT, 100, 100, 200, 0) as LinearElement;
    arrow.points = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    expect(linearMidpoint(arrow)).toEqual({ x: 200, y: 100 });
  });

  it('keeps a label centred on its connector as shapes move', () => {
    const a = store().createElement('rectangle', ROOT, 0, 0, 100, 60);
    const b = store().createElement('rectangle', ROOT, 400, 0, 100, 60);
    store().addElement(a);
    store().addElement(b);
    const arrow = store().createElement('arrow', ROOT, 100, 30, 300, 0) as LinearElement;
    store().addElement(arrow);
    store().bindArrow(arrow.id, 'start', a.id, 0);
    store().bindArrow(arrow.id, 'end', b.id, 0);
    const label = store().createBoundText(arrow.id, 'REST');
    store().updateElement(label.id, { width: 40, height: 20 } as Partial<MavisElement>);

    store().moveElementWithBindings(b.id, 400, 300);

    const movedArrow = store().elements.get(arrow.id) as LinearElement;
    const movedLabel = store().elements.get(label.id)!;
    const mid = linearMidpoint(movedArrow);
    expect(movedLabel.x + movedLabel.width / 2).toBeCloseTo(mid.x, 5);
    expect(movedLabel.y + movedLabel.height / 2).toBeCloseTo(mid.y, 5);
  });
});

describe('save tracking across diagrams', () => {
  beforeEach(resetStores);

  it('reports only diagrams whose elements changed since load/save', () => {
    const a = store().createElement('rectangle', ROOT, 0, 0, 10, 10);
    const b = store().createElement('rectangle', 'child', 0, 0, 10, 10);
    useElementsStore.setState({ elements: new Map([[a.id, a], [b.id, b]]) });
    const diagrams = new Map(useDiagramStore.getState().diagrams);
    diagrams.set('child', { ...diagrams.get(ROOT)!, id: 'child', parentDiagramId: ROOT });
    recordSaved(ROOT, [a]);
    recordSaved('child', [b]);

    expect(findDirtyDiagrams(store().elements, diagrams)).toEqual([]);

    store().updateElement(b.id, { x: 50 });
    expect(findDirtyDiagrams(store().elements, diagrams).map((d) => d.diagram.id)).toEqual(['child']);
  });

  it('treats a deletion as a change', () => {
    const a = store().createElement('rectangle', ROOT, 0, 0, 10, 10);
    useElementsStore.setState({ elements: new Map([[a.id, a]]) });
    recordSaved(ROOT, [a]);
    store().deleteElements([a.id]);
    const dirty = findDirtyDiagrams(store().elements, useDiagramStore.getState().diagrams);
    expect(dirty.map((d) => [d.diagram.id, d.elements.length])).toEqual([[ROOT, 0]]);
  });

  it('ignores diagrams that were never loaded and are empty', () => {
    expect(findDirtyDiagrams(store().elements, useDiagramStore.getState().diagrams)).toEqual([]);
  });
});

describe('auto-layout', () => {
  beforeEach(resetStores);

  it('lays a chain out along the requested direction without overlaps', async () => {
    const nodes = ['a', 'b', 'c'].map((id) => ({ id, width: 100, height: 60 }));
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ];
    const lr = await computeLayout(nodes, edges, 'LR');
    expect(lr.get('a')!.x).toBeLessThan(lr.get('b')!.x);
    expect(lr.get('b')!.x).toBeLessThan(lr.get('c')!.x);
    const tb = await computeLayout(nodes, edges, 'TB');
    expect(tb.get('a')!.y).toBeLessThan(tb.get('c')!.y);
    // Normalized to start at the origin
    expect(Math.min(...Array.from(tb.values()).map((p) => p.x))).toBe(0);
  });

  it('tidy up separates overlapping connected shapes in one undo step', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const el = store().createElement('rectangle', ROOT, 10 * i, 10 * i, 120, 80);
      store().addElement(el);
      ids.push(el.id);
    }
    for (let i = 0; i < 2; i++) {
      const arrow = store().createElement('arrow', ROOT, 0, 0, 10, 10);
      store().addElement(arrow);
      store().bindArrow(arrow.id, 'start', ids[i], 0);
      store().bindArrow(arrow.id, 'end', ids[i + 1], 0);
    }
    const before = ids.map((id) => ({ ...store().elements.get(id)! }));

    expect(await tidyUpDiagram(ROOT)).toBe(true);
    const after = ids.map((id) => store().elements.get(id)!);
    for (let i = 0; i < after.length; i++) {
      for (let j = i + 1; j < after.length; j++) {
        const p = after[i];
        const q = after[j];
        const overlap = p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
        expect(overlap).toBe(false);
      }
    }
    store().undo();
    expect(ids.map((id) => store().elements.get(id)!.x)).toEqual(before.map((b) => b.x));
  });
});

describe('Mermaid import', () => {
  beforeEach(resetStores);

  const SOURCE = `flowchart LR
    user((User)) -->|HTTPS| web[Web]
    web --> api
    web --> db
    subgraph backend [Backend]
      api[API] -->|SQL| db[(DB)]
    end`;

  it('turns subgraphs into portals with nested diagrams', async () => {
    const result = await importMermaidGraph(parseMermaidFlowchart(SOURCE), { x: 0, y: 0 });
    expect(result.diagrams).toBe(1);
    const root = labelled(ROOT);
    const portal = root.get('Backend') as PortalElement;
    expect(portal.type).toBe('portal');
    const child = useDiagramStore.getState().diagrams.get(portal.targetDiagramId)!;
    expect(child.parentDiagramId).toBe(ROOT);
    expect(child.parentPortalId).toBe(portal.id);
    // Shapes API and DB, plus the SQL connector label between them
    expect(Array.from(labelled(child.id).keys()).sort()).toEqual(['API', 'DB', 'SQL']);
  });

  it('lifts cross-boundary links to the portal and merges duplicates', async () => {
    await importMermaidGraph(parseMermaidFlowchart(SOURCE), { x: 0, y: 0 });
    const root = labelled(ROOT);
    const web = root.get('Web')!;
    const portal = root.get('Backend')!;
    // web --> api and web --> db both become one Web → Backend arrow
    const rootArrows = all().filter((e) => e.diagramId === ROOT && e.type === 'arrow') as LinearElement[];
    const webToPortal = rootArrows.filter(
      (a) => a.startBinding?.elementId === web.id && a.endBinding?.elementId === portal.id,
    );
    expect(webToPortal).toHaveLength(1);
    expect(rootArrows).toHaveLength(2); // + User → Web
  });

  it('is a single undo step', async () => {
    await importMermaidGraph(parseMermaidFlowchart(SOURCE), { x: 0, y: 0 });
    expect(all().length).toBeGreaterThan(5);
    store().undo();
    expect(all()).toHaveLength(0);
  });
});

describe('applying AI proposals', () => {
  beforeEach(resetStores);

  it('connects new shapes to existing ones by label, only within the diagram', async () => {
    // An "API" exists here and in another diagram
    const api = store().createElement('rectangle', ROOT, 0, 0, 140, 70);
    store().addElement(api);
    store().createBoundText(api.id, 'API');
    const elsewhere = store().createElement('rectangle', 'other-diagram', 0, 0, 140, 70);
    store().addElement(elsewhere);
    store().createBoundText(elsewhere.id, 'Cache');

    const result = await applyProposal({
      proposalId: 'p1',
      description: 'Add a cache',
      status: 'pending',
      changes: [{ action: 'add', elementType: 'rectangle', label: 'Cache' }],
      connections: [{ fromLabel: 'API', toLabel: 'Cache', label: 'reads' }],
    });

    expect(result).toEqual({ added: 1, modified: 0, deleted: 0, connected: 1, recorded: 0 });
    const arrow = all().find((e) => e.type === 'arrow') as LinearElement;
    expect(arrow.diagramId).toBe(ROOT);
    expect(arrow.startBinding?.elementId).toBe(api.id);
    const cache = store().elements.get(arrow.endBinding!.elementId)!;
    expect(cache.diagramId).toBe(ROOT);
    expect(cache.id).not.toBe(elsewhere.id);
    // Placed beside the existing content
    expect(cache.x).toBeGreaterThan(api.x + api.width);
  });

  it('shows a component from another diagram here as the same one, opening the same diagram', async () => {
    const detail = useDiagramStore.getState().createDiagram(ROOT, 'orig', 'Payments');
    const result = await applyProposal({
      proposalId: 'p3',
      description: 'Show Payments here',
      status: 'pending',
      changes: [
        {
          action: 'add',
          elementType: 'portal',
          label: 'Payments',
          componentId: 'c-payments',
          drawnOn: 'Shop',
          detailDiagramId: detail.id,
        },
      ],
      connections: [],
    });
    expect(result.added).toBe(1);
    const portal = all().find((e) => e.type === 'portal') as PortalElement;
    expect(portal).toMatchObject({ componentId: 'c-payments', targetDiagramId: detail.id });
  });

  it('records a connection to a component drawn on another diagram, and draws the rest', async () => {
    const { useModelStore } = await import('../stores/modelStore');
    useModelStore.setState({ projectId: 'p1', model: null, fetchedAt: 0 });
    saveRelationship.mockClear();
    const api = store().createElement('rectangle', ROOT, 0, 0, 140, 70);
    store().addElement(api);
    store().createBoundText(api.id, 'API');

    const result = await applyProposal({
      proposalId: 'p4',
      description: 'API charges through Stripe; a new queue feeds it',
      status: 'pending',
      changes: [{ action: 'add', elementType: 'rectangle', label: 'Queue' }],
      connections: [
        // Stripe is drawn on another diagram
        { fromLabel: 'API', toLabel: 'Stripe', label: 'charges', toComponentId: 'c-stripe' },
        { fromLabel: 'Queue', toLabel: 'Stripe', toComponentId: 'c-stripe' },
        { fromLabel: 'Queue', toLabel: 'API' },
      ],
    });
    expect(result).toMatchObject({ added: 1, connected: 1, recorded: 2 });
    const queue = all().find(
      (e) => e.type === 'rectangle' && e.id !== api.id,
    )!;
    expect(saveRelationship.mock.calls).toEqual([
      ['p1', { sourceId: api.id, targetId: 'c-stripe', description: 'charges' }],
      // A shape this proposal added: its own id is its component
      ['p1', { sourceId: queue.id, targetId: 'c-stripe' }],
    ]);
    // Only the connection with both ends here became an arrow
    expect(all().filter((e) => e.type === 'arrow')).toHaveLength(1);
  });

  it('a failure part-way leaves nothing behind (so a retry can’t double it)', async () => {
    const api = store().createElement('rectangle', ROOT, 0, 0, 140, 70);
    store().addElement(api);
    store().createBoundText(api.id, 'API');
    const before = { elements: store().elements, historyIndex: store().historyIndex };
    const diagramsBefore = useDiagramStore.getState().diagrams.size;
    // The last change fails, after the shapes, a portal and a connection went in
    const failing = vi.spyOn(store(), 'deleteElements').mockImplementation(() => {
      throw new Error('disk on fire');
    });
    await expect(
      applyProposal({
        proposalId: 'p5',
        description: 'Half of this would be bad',
        status: 'pending',
        changes: [
          { action: 'add', elementType: 'rectangle', label: 'Cache' },
          { action: 'add', elementType: 'portal', label: 'Billing' },
          { action: 'delete', elementId: api.id },
        ],
        connections: [{ fromLabel: 'API', toLabel: 'Cache' }],
      }),
    ).rejects.toThrow('disk on fire');
    failing.mockRestore();
    expect(store().elements).toBe(before.elements);
    expect(store().historyIndex).toBe(before.historyIndex);
    expect(useDiagramStore.getState().diagrams.size).toBe(diagramsBefore);
  });

  it('applies as one undo step and ignores unsafe property changes', async () => {
    const api = store().createElement('rectangle', ROOT, 0, 0, 140, 70);
    store().addElement(api);
    store().createBoundText(api.id, 'API');
    await applyProposal({
      proposalId: 'p2',
      description: 'Restyle',
      status: 'pending',
      changes: [
        { action: 'modify', elementId: 'API', label: 'Gateway', properties: { strokeColor: '#f00', isDeleted: true } },
        { action: 'add', elementType: 'ellipse', label: 'Users' },
      ],
      connections: [],
    });
    const restyled = store().elements.get(api.id)!;
    expect(restyled.strokeColor).toBe('#f00');
    expect(restyled.isDeleted).toBe(false);
    expect(labelled(ROOT).has('Gateway')).toBe(true);

    store().undo();
    expect(store().elements.get(api.id)!.strokeColor).toBe('#1e1e1e');
    expect(labelled(ROOT).has('API')).toBe(true);
    expect(all().some((e) => e.type === 'ellipse')).toBe(false);
  });
});

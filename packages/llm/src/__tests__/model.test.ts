import { describe, it, expect } from 'vitest';
import type { MavisDrawScene, MavisElement, StoredComponent } from '@mavisdraw/types';
import {
  buildProjectModel,
  componentById,
  componentKeyOf,
  dependenciesOf,
  dependentsOf,
  descendantsOf,
  possibleDuplicates,
  renameEdits,
  undrawnOn,
} from '../model';

// ── A small online shop, drawn on two levels ──────────────────

const base = {
  angle: 0,
  opacity: 100,
  strokeColor: '#000',
  backgroundColor: 'transparent',
  fillStyle: 'none',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 1,
  seed: 1,
  renderMode: 'clean',
  layerId: 'default',
  groupIds: [],
  isLocked: false,
  isDeleted: false,
  boundElements: [],
  version: 1,
  updatedAt: 1,
  x: 0,
  y: 0,
  width: 100,
  height: 50,
};

const diagram = (id: string, title: string, parentDiagramId: string | null = null) => ({
  id,
  projectId: 'p',
  parentDiagramId,
  parentPortalId: null,
  title,
  viewBackgroundColor: '#fff',
  gridEnabled: true,
  gridSize: 20,
  renderMode: 'clean' as const,
  layers: [],
  createdBy: 'u',
  createdAt: 1,
  updatedAt: 1,
});

const text = (id: string, diagramId: string, value: string, containerId: string | null) =>
  ({
    ...base,
    id,
    diagramId,
    type: 'text',
    text: value,
    containerId,
    fontSize: 16,
    fontFamily: 'x',
    textAlign: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.25,
  }) as unknown as MavisElement;

/** A labelled shape; `componentId` undefined = drawn before the model existed. */
function shape(
  id: string,
  diagramId: string,
  label: string | null,
  componentId?: string,
  type = 'rectangle',
): MavisElement[] {
  const el = {
    ...base,
    id,
    diagramId,
    type,
    roundness: 0,
    ...(componentId ? { componentId } : {}),
    boundElements: label ? [{ id: `${id}-t`, type: 'text' }] : [],
  } as unknown as MavisElement;
  return label ? [el, text(`${id}-t`, diagramId, label, id)] : [el];
}

function portal(
  id: string,
  diagramId: string,
  label: string,
  target: string,
  componentId?: string,
) {
  return {
    ...base,
    id,
    diagramId,
    type: 'portal',
    label,
    targetDiagramId: target,
    thumbnailDataUrl: null,
    portalStyle: 'card',
    githubLink: null,
    codePath: 'services/api',
    ...(componentId ? { componentId } : {}),
  } as unknown as MavisElement;
}

function arrow(id: string, diagramId: string, from: string, to: string, label?: string) {
  const els = [
    {
      ...base,
      id,
      diagramId,
      type: 'arrow',
      points: [
        [0, 0],
        [10, 0],
      ],
      startBinding: { elementId: from, gap: 0 },
      endBinding: { elementId: to, gap: 0 },
      routingMode: 'straight',
      startArrowhead: null,
      endArrowhead: 'arrow',
      boundElements: label ? [{ id: `${id}-t`, type: 'text' }] : [],
    } as unknown as MavisElement,
  ];
  if (label) els.push(text(`${id}-t`, diagramId, label, id));
  return els;
}

function shopScene(): MavisDrawScene {
  return {
    rootDiagramId: 'root',
    diagrams: [diagram('root', 'Shop'), diagram('api-d', 'API', 'root')],
    elements: [
      // Top level
      ...shape('web', 'root', 'Web App', 'c-web'),
      portal('api', 'root', 'API', 'api-d', 'c-api'),
      ...shape('pg', 'root', 'Postgres', undefined, 'ellipse'), // legacy: no componentId
      ...arrow('a1', 'root', 'web', 'api', 'HTTPS'),
      ...arrow('a2', 'root', 'api', 'pg'),
      ...shape('doodle', 'root', null), // unlabelled: plain drawing
      text('note', 'root', 'TODO: caching', null), // free text: plain drawing
      // Inside the API
      ...shape('orders', 'api-d', 'Orders', 'c-orders'),
      ...shape('payments', 'api-d', 'Payments', 'c-payments'),
      ...shape('pg2', 'api-d', 'Postgres', 'pg', 'ellipse'), // the same Postgres
      ...shape('stripe', 'api-d', 'Stripe', 'c-stripe'),
      ...arrow('a3', 'api-d', 'orders', 'pg2', 'SQL'),
      ...arrow('a4', 'api-d', 'payments', 'stripe', 'charges'),
      ...arrow('a5', 'api-d', 'orders', 'orders'), // a loop is no relationship
    ],
  };
}

const stored = {
  components: [
    { id: 'c-stripe', name: 'Stripe', kind: 'external', description: 'Card payments' },
    { id: 'c-email', name: 'Email provider', kind: 'external' }, // in the model only
  ] as StoredComponent[],
  relationships: [
    { sourceId: 'c-orders', targetId: 'c-payments', description: 'publishes OrderPlaced' },
    { sourceId: 'c-web', targetId: 'c-api', technology: 'REST' },
    { sourceId: 'c-gone', targetId: 'c-api' }, // its component no longer exists
  ],
};

const model = () => buildProjectModel(shopScene(), stored, { repo: 'acme/shop' });
const byName = (name: string) => model().components.find((c) => c.name === name)!;

describe('components', () => {
  it('are the labelled shapes; plain drawing and free text are not', () => {
    expect(model().components.map((c) => c.name)).toEqual([
      'API',
      'Email provider',
      'Orders',
      'Payments',
      'Postgres',
      'Stripe',
      'Web App',
    ]);
  });

  it('keep the id a shape carries; a legacy labelled shape is its own id', () => {
    const els = shopScene().elements;
    const byId = new Map(els.map((e) => [e.id, e]));
    expect(componentKeyOf(byId.get('web')!, byId)).toBe('c-web');
    expect(componentKeyOf(byId.get('pg')!, byId)).toBe('pg');
    expect(componentKeyOf(byId.get('doodle')!, byId)).toBeNull();
    expect(componentKeyOf(byId.get('a1')!, byId)).toBeNull();
  });

  it('appear on every diagram that shows them, with where that is', () => {
    expect(byName('Postgres').appearances).toEqual([
      { diagramId: 'root', elementId: 'pg', path: ['Shop'] },
      { diagramId: 'api-d', elementId: 'pg2', path: ['Shop', 'API'] },
    ]);
  });

  it('have a kind from their shape unless one was recorded', () => {
    expect(byName('API').kind).toBe('system'); // opens into a diagram
    expect(byName('Postgres').kind).toBe('datastore'); // drawn as a cylinder-ish ellipse
    expect(byName('Orders').kind).toBe('service');
    expect(byName('Stripe')).toMatchObject({ kind: 'external', description: 'Card payments' });
  });

  it('know their detail diagram and their code', () => {
    expect(byName('API')).toMatchObject({
      detailDiagramId: 'api-d',
      code: { repo: 'acme/shop', path: 'services/api' },
    });
    expect(byName('Orders').code).toBeNull();
  });

  it('can exist only in the model (recorded, not drawn)', () => {
    expect(byName('Email provider')).toMatchObject({ appearances: [], stored: true });
  });

  it('are named by what most of their labels say', () => {
    const scene = shopScene();
    for (const n of [3, 4, 5]) {
      scene.diagrams.push(diagram(`ops${n}`, `Ops ${n}`, 'root'));
      scene.elements.push(...shape(`pg${n}`, `ops${n}`, 'PostgreSQL', 'pg', 'ellipse'));
    }
    const pg = buildProjectModel(scene).components.find((c) => c.id === 'pg')!;
    expect(pg.name).toBe('PostgreSQL');
  });

  it('ignore deleted shapes', () => {
    const scene = shopScene();
    scene.elements = scene.elements.map((e) => (e.id === 'web' ? { ...e, isDeleted: true } : e));
    expect(buildProjectModel(scene).components.some((c) => c.id === 'c-web')).toBe(false);
  });
});

describe('containment', () => {
  it('puts what is drawn on a detail diagram inside its component', () => {
    expect(byName('Orders').parents).toEqual(['c-api']);
    expect(byName('Payments').parents).toEqual(['c-api']);
    expect([...descendantsOf(model(), 'c-api')].sort()).toEqual(['c-orders', 'c-payments']);
  });

  it('leaves out what is only there as context', () => {
    expect(byName('Stripe').parents).toEqual([]); // external
    expect(byName('Postgres').parents).toEqual([]); // also drawn next to the API
  });

  it('reaches any depth', () => {
    const scene = shopScene();
    scene.diagrams.push(diagram('orders-d', 'Orders', 'api-d'));
    scene.elements = scene.elements.map((e) =>
      e.id === 'orders' ? portal('orders', 'api-d', 'Orders', 'orders-d', 'c-orders') : e,
    );
    scene.elements.push(...shape('cart', 'orders-d', 'Cart', 'c-cart'));
    expect([...descendantsOf(buildProjectModel(scene, stored), 'c-api')].sort()).toEqual([
      'c-cart',
      'c-orders',
      'c-payments',
    ]);
  });
});

describe('relationships', () => {
  it('come from arrows between appearances, with their labels', () => {
    const r = model().relationships.find((x) => x.id === 'c-orders->pg')!;
    expect(r).toMatchObject({ labels: ['SQL'], drawn: [{ diagramId: 'api-d', elementId: 'a3' }] });
  });

  it('are one relationship however many diagrams draw it', () => {
    const scene = shopScene();
    scene.diagrams.push(diagram('ops', 'Ops', 'root'));
    scene.elements.push(
      ...shape('w2', 'ops', 'Web App', 'c-web'),
      portal('api2', 'ops', 'API', 'api-d', 'c-api'),
      ...arrow('a9', 'ops', 'w2', 'api2', 'HTTPS'),
    );
    const r = buildProjectModel(scene).relationships.filter((x) => x.id === 'c-web->c-api');
    expect(r).toHaveLength(1);
    expect(r[0].drawn.map((d) => d.diagramId)).toEqual(['root', 'ops']);
    expect(r[0].labels).toEqual(['HTTPS']);
  });

  it('take recorded details, and can be recorded without being drawn', () => {
    const rels = model().relationships;
    expect(rels.find((r) => r.id === 'c-web->c-api')).toMatchObject({
      technology: 'REST',
      stored: true,
    });
    expect(rels.find((r) => r.id === 'c-orders->c-payments')).toMatchObject({
      description: 'publishes OrderPlaced',
      drawn: [],
    });
    expect(rels.some((r) => r.sourceId === 'c-gone')).toBe(false);
    expect(rels.some((r) => r.sourceId === r.targetId)).toBe(false);
  });
});

describe('dependencies', () => {
  it('of a component: what it points at directly', () => {
    expect(dependenciesOf(model(), 'c-api').map((d) => d.componentId)).toEqual(['pg']);
    expect(dependentsOf(model(), 'c-api').map((d) => d.componentId)).toEqual(['c-web']);
  });

  it('roll up from inside it: the API uses Stripe because Payments does', () => {
    const deps = dependenciesOf(model(), 'c-api', { rollup: true });
    expect(deps.map((d) => [d.componentId, d.via])).toEqual([
      ['pg', null],
      ['pg', 'c-orders'],
      ['c-stripe', 'c-payments'],
    ]);
    // Relationships between its own parts aren't dependencies of the whole
    expect(deps.some((d) => d.componentId === 'c-payments')).toBe(false);
  });

  it('roll up for dependents too', () => {
    expect(dependentsOf(model(), 'c-stripe').map((d) => d.componentId)).toEqual(['c-payments']);
    expect(dependentsOf(model(), 'pg', { rollup: true }).map((d) => d.componentId)).toEqual([
      'c-api',
      'c-orders',
    ]);
  });
});

describe('suggestions', () => {
  it('known connections not drawn on a diagram', () => {
    expect(undrawnOn(model(), 'api-d').map((r) => r.id)).toEqual(['c-orders->c-payments']);
    expect(undrawnOn(model(), 'root')).toEqual([]);
  });

  it('same-named components on different diagrams are offered for linking', () => {
    const scene = shopScene();
    scene.elements.push(
      ...shape('r1', 'root', 'Redis', 'c-redis-1'),
      ...shape('r2', 'api-d', 'redis ', 'c-redis-2'),
      // Two on one diagram are deliberately different
      ...shape('q1', 'root', 'Queue', 'c-q1'),
      ...shape('q2', 'root', 'Queue', 'c-q2'),
    );
    const groups = possibleDuplicates(buildProjectModel(scene));
    expect(groups.map((g) => g.map((c) => c.id).sort())).toEqual([['c-redis-1', 'c-redis-2']]);
  });

  it('looks components up by id', () => {
    expect(componentById(model(), 'c-api')?.name).toBe('API');
    expect(componentById(model(), 'nope')).toBeUndefined();
  });
});

describe('renaming', () => {
  it('relabels every appearance and the diagram it opens into', () => {
    expect(renameEdits(shopScene(), 'c-api', 'Core API')).toEqual({
      elements: [{ id: 'api', diagramId: 'root', changes: { label: 'Core API' } }],
      diagrams: [{ id: 'api-d', title: 'Core API' }],
    });
    expect(renameEdits(shopScene(), 'pg', 'Orders DB').elements).toEqual([
      { id: 'pg-t', diagramId: 'root', changes: { text: 'Orders DB' } },
      { id: 'pg2-t', diagramId: 'api-d', changes: { text: 'Orders DB' } },
    ]);
  });

  it('leaves labels that already say so alone', () => {
    expect(renameEdits(shopScene(), 'c-api', 'API')).toEqual({ elements: [], diagrams: [] });
  });
});

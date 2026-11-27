import { describe, it, expect } from 'vitest';
import type { ModelComponent, ModelRelationship, ProjectModel } from '@mavisdraw/types';
import { toStructurizrDsl } from '../structurizr';

const c = (id: string, name: string, extra: Partial<ModelComponent> = {}): ModelComponent => ({
  id,
  name,
  kind: 'service',
  description: null,
  technology: null,
  owner: null,
  tags: [],
  links: [],
  code: null,
  detailDiagramId: null,
  appearances: [],
  parents: [],
  stored: false,
  ...extra,
});
const r = (sourceId: string, targetId: string, extra: Partial<ModelRelationship> = {}) => ({
  id: `${sourceId}->${targetId}`,
  sourceId,
  targetId,
  description: null,
  technology: null,
  labels: [],
  drawn: [],
  stored: false,
  ...extra,
});

// An online shop: a customer, the shop (API inside it, with Orders and
// Payments inside the API, and Cart inside Orders), and Stripe
const model: ProjectModel = {
  components: [
    c('customer', 'Customer', { kind: 'person' }),
    c('shop', 'Online Shop', { kind: 'system', description: 'Sells "things"' }),
    c('api', 'API', { parents: ['shop'], technology: 'Node.js', owner: 'Team Core' }),
    c('db', 'Orders DB', { kind: 'datastore', parents: ['shop'], technology: 'Postgres' }),
    c('orders', 'Orders', { parents: ['api'] }),
    c('payments', 'Payments', { parents: ['api'] }),
    c('cart', 'Cart', { parents: ['orders'] }),
    c('stripe', 'Stripe', {
      kind: 'external',
      links: [{ label: 'Docs', url: 'https://stripe.com/docs' }],
    }),
  ],
  relationships: [
    r('customer', 'shop', { labels: ['buys from'] }),
    r('orders', 'db', { description: 'reads and writes', technology: 'SQL' }),
    r('payments', 'stripe', { labels: ['charges'], technology: 'HTTPS' }),
    r('api', 'orders'), // parent → child: not allowed in C4, left out
  ],
};

const dsl = toStructurizrDsl(model, { name: 'Shop' });

describe('Structurizr DSL export', () => {
  it('maps levels to C4: people and systems, then containers, then components', () => {
    expect(dsl).toContain('customer = person "Customer" ""');
    expect(dsl).toContain('online_shop = softwareSystem "Online Shop" "Sells \\"things\\"" {');
    expect(dsl).toContain('api = container "API" "" "Node.js" {');
    expect(dsl).toContain('orders_db = container "Orders DB" "" "Postgres" {');
    expect(dsl).toContain('orders = component "Orders" "" ""');
    // A level below components folds into its container
    expect(dsl).toContain('cart = component "Cart" "" ""');
    expect(dsl).toContain('stripe = softwareSystem "Stripe" "" {');
  });

  it('keeps kinds as tags, links and owners', () => {
    expect(dsl).toMatch(
      /stripe = softwareSystem[^\n]*\{\n\s+tags "External"\n\s+url "https:\/\/stripe\.com\/docs"/,
    );
    expect(dsl).toMatch(/orders_db = container[^\n]*\{\n\s+tags "Database"/);
    expect(dsl).toContain('"owner" "Team Core"');
  });

  it('writes relationships with hierarchical identifiers, description and technology', () => {
    expect(dsl).toContain('customer -> online_shop "buys from"');
    expect(dsl).toContain(
      'online_shop.api.orders -> online_shop.orders_db "reads and writes" "SQL"',
    );
    expect(dsl).toContain('online_shop.api.payments -> stripe "charges" "HTTPS"');
    expect(dsl).not.toContain('online_shop.api -> online_shop.api.orders');
  });

  it('generates a view for every level with something inside', () => {
    expect(dsl).toContain('systemLandscape "Landscape" {');
    expect(dsl).toContain('systemContext online_shop "online_shop-context" {');
    expect(dsl).toContain('container online_shop "online_shop-containers" {');
    expect(dsl).toContain('component online_shop.api "online_shop-api-components" {');
    // External systems get no views of their own
    expect(dsl).not.toContain('systemContext stripe');
  });

  it('makes identifiers unique and valid, and strings one line', () => {
    const out = toStructurizrDsl(
      {
        components: [c('a', 'API'), c('b', 'api'), c('n', '42 things\nand more')],
        relationships: [],
      },
      { name: 'x' },
    );
    expect(out).toContain('api = softwareSystem "API"');
    expect(out).toContain('api_2 = softwareSystem "api"');
    expect(out).toContain('e_42_things_and_more = softwareSystem "42 things and more"');
  });

  it('opens and closes every block', () => {
    expect(dsl.split('{').length).toBe(dsl.split('}').length);
    expect(dsl.startsWith('workspace "Shop" "Exported from MavisDraw" {')).toBe(true);
  });
});

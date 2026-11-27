import { describe, it, expect } from 'vitest';
import type { MavisDrawScene, MavisElement } from '@mavisdraw/types';
import {
  affectsStructure,
  architectureDrift,
  COMMENT_MARKER,
  headFiles,
  impactOnProject,
  manifestsToRead,
  renderPrComment,
  type PrFileChange,
} from '../services/prDrift.js';
import { arrow, box, diagram, portal } from './fixtures/scene.js';

// ── A small monorepo, before and after a pull request ──────────────────

const pkg = (o: Record<string, unknown>) => JSON.stringify(o);
const base = new Map<string, string>([
  ['package.json', pkg({ name: 'shop', private: true, workspaces: ['apps/*', 'packages/*'] })],
  [
    'apps/api/package.json',
    pkg({
      name: '@shop/api',
      scripts: { start: 'node .' },
      dependencies: { '@shop/core': 'workspace:*', pg: '^8', stripe: '^14' },
    }),
  ],
  [
    'apps/storefront/package.json',
    pkg({
      name: '@shop/storefront',
      scripts: { dev: 'vite' },
      dependencies: { '@shop/ui': 'workspace:*', '@shop/api-client': 'workspace:*' },
    }),
  ],
  ['packages/core/package.json', pkg({ name: '@shop/core' })],
  ['packages/ui/package.json', pkg({ name: '@shop/ui' })],
  ['packages/api-client/package.json', pkg({ name: '@shop/api-client' })],
]);
const baseFiles = [
  ...base.keys(),
  'apps/api/src/routes/orders.ts',
  'apps/api/src/services/payments.ts',
  'apps/storefront/src/pages/cart.tsx',
  'packages/api-client/src/index.ts',
  'packages/core/src/order.ts',
];

const changes: PrFileChange[] = [
  { filename: 'apps/api/package.json', status: 'modified' },
  { filename: 'apps/api/src/services/payments.ts', status: 'modified' },
  { filename: 'apps/api/src/services/assistant.ts', status: 'added' },
  { filename: 'apps/storefront/package.json', status: 'modified' },
  { filename: 'packages/api-client/package.json', status: 'removed' },
  { filename: 'packages/api-client/src/index.ts', status: 'removed' },
  { filename: 'packages/billing/package.json', status: 'added' },
  { filename: 'packages/billing/src/invoice.ts', status: 'added' },
  { filename: 'docs/README.md', status: 'modified' },
];
const head = new Map<string, string>([
  [
    'apps/api/package.json',
    pkg({
      name: '@shop/api',
      scripts: { start: 'node .' },
      dependencies: {
        '@shop/core': 'workspace:*',
        '@shop/billing': 'workspace:*',
        '@anthropic-ai/sdk': '^0.30',
        pg: '^8',
        stripe: '^14',
      },
    }),
  ],
  [
    'apps/storefront/package.json',
    pkg({
      name: '@shop/storefront',
      scripts: { dev: 'vite' },
      dependencies: { '@shop/ui': 'workspace:*' },
    }),
  ],
  ['packages/billing/package.json', pkg({ name: '@shop/billing' })],
]);

// ── The map generated from the base ────────────────────────────────────

function mapScene(): MavisDrawScene {
  const p = (id: string, label: string, codePath: string) => portal(id, label, `${id}-d`, codePath);
  return {
    rootDiagramId: 'root',
    diagrams: [
      diagram('root', 'Shop'),
      ...['api', 'storefront', 'core', 'ui', 'client'].map((id) => diagram(`${id}-d`, id, 'root')),
    ],
    elements: [
      p('api', 'api', 'apps/api'),
      p('storefront', 'storefront', 'apps/storefront'),
      p('core', 'core', 'packages/core'),
      p('ui', 'ui', 'packages/ui'),
      p('client', 'api-client', 'packages/api-client'),
      ...box('pg', 'PostgreSQL'),
      ...box('stripe', 'Stripe'),
      arrow('a1', 'api', 'core'),
      arrow('a2', 'api', 'pg'),
      arrow('a3', 'api', 'stripe'),
      arrow('a4', 'storefront', 'ui'),
      arrow('a5', 'storefront', 'client'),
    ] as MavisElement[],
  };
}

const pr = { repo: 'acme/shop', number: 12, title: 'Invoices and an assistant' };
const drift = () => architectureDrift({ repoName: 'shop', baseFiles, changes, base, head });

describe('reading a pull request', () => {
  it('works out the file list at the head', () => {
    const files = headFiles(baseFiles, changes);
    expect(files).toContain('packages/billing/package.json');
    expect(files).not.toContain('packages/api-client/src/index.ts');
    expect(
      headFiles(['a.ts'], [{ filename: 'b.ts', status: 'renamed', previous_filename: 'a.ts' }]),
    ).toEqual(['b.ts']);
  });

  it('only analyzes structure when manifests or the file layout change', () => {
    expect(affectsStructure(changes)).toBe(true);
    expect(affectsStructure([{ filename: 'apps/api/src/x.ts', status: 'modified' }])).toBe(false);
    expect(affectsStructure([{ filename: 'node_modules/x/package.json', status: 'added' }])).toBe(
      true,
    );
  });

  it('reads every manifest at the base, and only changed ones at the head', () => {
    const toRead = manifestsToRead(baseFiles, changes);
    expect(toRead.base.sort()).toEqual(Array.from(base.keys()).sort());
    expect(toRead.changed.sort()).toEqual([
      'apps/api/package.json',
      'apps/storefront/package.json',
      'packages/billing/package.json',
    ]);
  });

  it('finds the architecture changes between base and head', () => {
    const lines = drift().map((d) => d.kind);
    expect(lines).toEqual(
      expect.arrayContaining([
        'component-added',
        'component-removed',
        'dependency-added',
        'resource-added',
      ]),
    );
  });
});

describe('what it means for the map', () => {
  const impact = () =>
    impactOnProject({
      project: { id: 'p1', name: 'Shop Map' },
      scene: mapScene(),
      changes,
      drift: drift(),
      pr,
    });

  it('names the components the files belong to, most touched first', () => {
    const { touched, unmapped } = impact();
    expect(touched.map((t) => [t.component.label, t.files])).toEqual([
      ['api', 3],
      ['api-client', 2],
      ['storefront', 1],
    ]);
    // billing (new) and docs/ aren't on the map
    expect(unmapped).toBe(3);
  });

  it('says which changes the map already shows', () => {
    const changesOut = impact().changes;
    const line = (s: string) => changesOut.find((c) => c.text.includes(s))!;
    expect(line('billing').onMap).toBe(false);
    expect(line('Anthropic API').onMap).toBe(false);
    // The package the PR deletes is still drawn
    expect(line('api-client is gone')).toMatchObject({ removal: true, onMap: false });
  });

  it('proposes the update on the level where the code lives', () => {
    const { proposal } = impact();
    expect(proposal?.diagramId).toBe('root');
    expect(proposal?.built.description).toBe(
      'acme/shop#12 “Invoices and an assistant” changes the architecture',
    );
    expect(proposal?.built.changes).toEqual(
      expect.arrayContaining([
        {
          action: 'add',
          elementType: 'portal',
          label: 'billing',
          properties: { codePath: 'packages/billing' },
        },
        { action: 'add', elementType: 'rectangle', label: 'Anthropic API' },
        { action: 'delete', elementId: 'client' },
      ]),
    );
    expect(proposal?.built.connections).toEqual(
      expect.arrayContaining([
        { fromLabel: 'api', toLabel: 'billing' },
        { fromLabel: 'api', toLabel: 'Anthropic API' },
      ]),
    );
  });

  it('proposes nothing when the map is already up to date', () => {
    const quiet = impactOnProject({
      project: { id: 'p1', name: 'Shop Map' },
      scene: mapScene(),
      changes: [{ filename: 'apps/api/src/services/payments.ts', status: 'modified' }],
      drift: [],
      pr,
    });
    expect(quiet.proposal).toBeNull();
    expect(quiet.touched.map((t) => t.component.label)).toEqual(['api']);
  });
});

describe('the comment', () => {
  it('summarises, links into the map and points at the proposal', () => {
    const impact = impactOnProject({
      project: { id: 'p1', name: 'Shop Map' },
      scene: mapScene(),
      changes,
      drift: drift(),
      pr,
    });
    const body = renderPrComment({
      impacts: [impact],
      headSha: 'abcdef1234567',
      appUrl: 'https://app.example',
      proposals: new Map([['p1', 'prop-1']]),
    });
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain('Touches **api**, **api-client**, **storefront**.');
    expect(body).toContain('| [api](https://app.example/p/p1/d/root) | Shop | 3 |');
    expect(body).toContain('| _not on the map_ | | 3 |');
    expect(body).toContain('now uses Anthropic API — _not on the map yet_');
    expect(body).toContain(
      'api-client is gone from the code (packages/api-client) — _still on the map_',
    );
    expect(body).toContain('(https://app.example/p/p1?proposals=open)');
    expect(body).toContain('Updated for abcdef1');
  });

  it('says so when a PR no longer touches the map', () => {
    const body = renderPrComment({
      impacts: [
        {
          project: { id: 'p1', name: 'Shop' },
          touched: [],
          unmapped: 2,
          changes: [],
          proposal: null,
        },
      ],
      headSha: '1234567',
      appUrl: 'https://app.example',
      proposals: new Map(),
    });
    expect(body).toContain('no longer touches the mapped architecture');
  });

  it('keeps a component name from breaking the table', () => {
    const scene = mapScene();
    (scene.elements[0] as unknown as { label: string }).label = 'api | gateway';
    const impact = impactOnProject({
      project: { id: 'p1', name: 'Shop' },
      scene,
      changes: [{ filename: 'apps/api/x.ts', status: 'modified' }],
      drift: [],
      pr,
    });
    const body = renderPrComment({
      impacts: [impact],
      headSha: '1234567',
      appUrl: 'https://app.example',
      proposals: new Map(),
    });
    expect(body).toContain('[api \\| gateway]');
  });

  it('cannot be used to inject links, mentions or HTML through map text', () => {
    const scene = mapScene();
    (scene.elements[0] as unknown as { label: string }).label =
      'API](https://evil.example/login) — **re-authenticate** [x <img src=x> @acme/everyone';
    const impact = impactOnProject({
      project: { id: 'p1', name: '[Security notice](https://evil.example) @victim-org/admins' },
      scene,
      changes: [{ filename: 'apps/api/x.ts', status: 'modified' }],
      drift: [],
      pr,
    });
    const body = renderPrComment({
      impacts: [impact, { ...impact, project: { id: 'p2', name: 'Other' } }],
      headSha: '1234567',
      appUrl: 'https://app.example',
      proposals: new Map(),
    });
    // Our own links are the only links
    const links = Array.from(body.matchAll(/(?<!\\)\]\((?!https:\/\/app\.example)/g));
    expect(links).toEqual([]);
    expect(body).not.toContain('https://evil');
    expect(body).not.toContain('<img');
    expect(body).not.toMatch(/@acme|@victim/);
    expect(body).toContain('\\[Security notice\\]');
  });

  it('stays within GitHub’s comment limits for huge changes', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      text: `pkg${i} now uses Thing ${i}`,
      removal: false,
      onMap: false,
    }));
    const body = renderPrComment({
      impacts: [
        {
          project: { id: 'p1', name: 'Shop' },
          touched: [],
          unmapped: 0,
          changes: many,
          proposal: null,
        },
      ],
      headSha: '1234567',
      appUrl: 'https://app.example',
      proposals: new Map(),
    });
    expect(body).toContain('…and 30 more');
    expect(body.length).toBeLessThan(65_536);
  });
});

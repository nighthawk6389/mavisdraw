import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { analyzeRepo, isManifest, parseCompose } from '../repo/analyze';
import { describeDrift, diffModels, repoToGraph, componentKey, SHARED_GROUP } from '../repo/map';

const FIXTURES = join(__dirname, '../../../../apps/web/e2e-real/fixtures');

function snapshotOf(dir: string, name = 'shop') {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(relative(dir, p).split('\\').join('/'));
    }
  };
  walk(dir);
  return {
    name,
    files,
    read: (path: string) => (isManifest(path) ? readFileSync(join(dir, path), 'utf8') : undefined),
  };
}

describe('repo analysis', () => {
  const model = analyzeRepo(snapshotOf(join(FIXTURES, 'shop-v1')));
  const byPath = Object.fromEntries(model.components.map((c) => [c.path, c]));

  it('finds apps and libraries, skipping the workspace root', () => {
    expect(model.components.map((c) => [c.path, c.kind])).toEqual([
      ['apps/api', 'app'],
      ['apps/storefront', 'app'],
      ['packages/api-client', 'library'],
      ['packages/core', 'library'],
      ['packages/ui', 'library'],
    ]);
    expect(byPath['apps/api'].name).toBe('api');
    expect(byPath['apps/api'].description).toBe('Orders and payments API');
  });

  it('links internal dependencies by package name', () => {
    expect(byPath['apps/storefront'].dependsOn).toEqual(['packages/api-client', 'packages/ui']);
    expect(byPath['apps/api'].dependsOn).toEqual(['packages/core']);
  });

  it('recognises datastores and services from dependencies and docker-compose', () => {
    expect(model.resources.map((r) => r.name)).toEqual(['PostgreSQL', 'Redis', 'Stripe']);
    // pg + compose postgres, compose redis (depends_on), stripe from package.json
    expect(byPath['apps/api'].uses).toEqual(['postgres', 'redis', 'stripe']);
  });

  it('lists the main folders of each component', () => {
    expect(byPath['apps/api'].modules).toEqual([
      { name: 'routes', files: 2 },
      { name: 'db', files: 1 },
      { name: 'services', files: 1 },
    ]);
    expect(byPath['packages/api-client'].modules).toEqual([]);
  });
});

describe('repo → nested map', () => {
  it('one level per component, resources at the top, labelled edges', () => {
    const { graph, components } = repoToGraph(analyzeRepo(snapshotOf(join(FIXTURES, 'shop-v1'))));
    expect(graph.subgraphs.get(componentKey('apps/api'))).toMatchObject({
      title: 'api',
      parent: null,
    });
    expect(components.get(componentKey('apps/api'))?.path).toBe('apps/api');
    expect(graph.nodes.get('r_postgres')).toMatchObject({
      label: 'PostgreSQL',
      shape: 'cylinder',
      subgraph: null,
    });
    expect(graph.nodes.get('r_stripe')?.shape).toBe('stadium');
    expect(graph.nodes.get(`${componentKey('apps/api')}__routes`)?.label).toBe('routes (2 files)');
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: componentKey('apps/api'),
        to: 'r_postgres',
        label: 'reads/writes',
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: componentKey('apps/storefront'),
        to: componentKey('packages/ui'),
        label: 'uses',
      }),
    );
  });

  it('groups many libraries behind a "Shared packages" level', () => {
    const libs = ['a', 'b', 'c', 'd'].map((n) => ({
      id: `packages/${n}`,
      name: n,
      path: `packages/${n}`,
      kind: 'library' as const,
      description: null,
      modules: [],
      dependsOn: [],
      uses: [],
    }));
    const { graph } = repoToGraph({ name: 'x', components: libs, resources: [] });
    expect(graph.subgraphs.get(SHARED_GROUP)?.title).toBe('Shared packages');
    expect(graph.subgraphs.get(componentKey('packages/a'))?.parent).toBe(SHARED_GROUP);
  });
});

describe('drift', () => {
  it('reports what changed in the code since the map was made', () => {
    const before = analyzeRepo(snapshotOf(join(FIXTURES, 'shop-v1')));
    const after = analyzeRepo(snapshotOf(join(FIXTURES, 'shop-v2')));
    expect(diffModels(before, after).map(describeDrift)).toEqual([
      'New package in the code: billing (packages/billing)',
      'api-client is gone from the code (packages/api-client)',
      'api now depends on billing',
      'api now uses Anthropic API',
    ]);
    expect(diffModels(before, before)).toEqual([]);
  });
});

describe('docker-compose parsing', () => {
  it('reads services, images, build contexts and both depends_on styles', () => {
    const services = parseCompose(`version: "3"
services:
  web:
    build:
      context: ./web
    depends_on: [api]
  api:
    build: .
    depends_on:
      db:
        condition: service_healthy
  db:
    image: "postgres:16"  # the database
`);
    expect(services).toEqual([
      { name: 'web', image: null, build: './web', dependsOn: ['api'] },
      { name: 'api', image: null, build: '.', dependsOn: ['db'] },
      { name: 'db', image: 'postgres:16', build: null, dependsOn: [] },
    ]);
  });
});

describe('dogfood: MavisDraw itself', () => {
  it('maps this repository sensibly', () => {
    const model = analyzeRepo(snapshotOf(join(__dirname, '../../../..'), 'mavisdraw'));
    const kinds = Object.fromEntries(model.components.map((c) => [c.path, c.kind]));
    expect(kinds['apps/web']).toBe('app');
    expect(kinds['apps/server']).toBe('app');
    expect(kinds['packages/types']).toBe('library');
    const server = model.components.find((c) => c.path === 'apps/server')!;
    expect(server.dependsOn).toContain('packages/types');
    expect(server.uses).toEqual(expect.arrayContaining(['postgres', 'anthropic']));
    // Test fixtures aren't components
    expect(model.components.some((c) => c.path.includes('fixtures'))).toBe(false);
  });
});

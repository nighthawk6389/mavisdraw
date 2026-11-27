import { describe, it, expect } from 'vitest';
import type { MavisDrawScene, MavisElement } from '@mavisdraw/types';
import {
  indexComponents,
  searchComponents,
  componentForPath,
  describeComponent,
} from '../components';

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

function box(id: string, label: string, diagramId = 'root'): MavisElement[] {
  return [
    {
      ...base,
      id,
      diagramId,
      type: 'rectangle',
      roundness: 0,
      boundElements: [{ id: `${id}-t`, type: 'text' }],
    },
    {
      ...base,
      id: `${id}-t`,
      diagramId,
      type: 'text',
      text: label,
      containerId: id,
      fontSize: 16,
      fontFamily: 'x',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.25,
    },
  ] as unknown as MavisElement[];
}

function portal(
  id: string,
  label: string,
  target: string,
  codePath: string | null,
  diagramId = 'root',
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
    githubLink: { owner: 'acme', repo: 'shop', path: codePath ?? '', ref: 'main' },
    codePath,
  } as unknown as MavisElement;
}

function arrow(id: string, from: string, to: string, label?: string): MavisElement[] {
  const els = [
    {
      ...base,
      id,
      diagramId: 'root',
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
    },
  ] as unknown as MavisElement[];
  if (label) {
    els.push({
      ...base,
      id: `${id}-t`,
      diagramId: 'root',
      type: 'text',
      text: label,
      containerId: id,
      fontSize: 16,
      fontFamily: 'x',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.25,
    } as unknown as MavisElement);
  }
  return els;
}

const scene: MavisDrawScene = {
  rootDiagramId: 'root',
  diagrams: [
    diagram('root', 'Shop'),
    diagram('api-d', 'API', 'root'),
    diagram('auth-d', 'Auth', 'api-d'),
  ],
  elements: [
    ...box('web', 'Web App'),
    portal('api', 'API', 'api-d', 'apps/api'),
    ...box('db', 'Orders DB'),
    ...arrow('a1', 'web', 'api', 'REST'),
    ...arrow('a2', 'api', 'db'),
    portal('auth', 'Auth Service', 'auth-d', 'apps/api/src/auth', 'api-d'),
    { ...base, id: 'unnamed', diagramId: 'root', type: 'ellipse' } as unknown as MavisElement,
    { ...(box('gone', 'Deleted Thing')[0] as object), isDeleted: true } as unknown as MavisElement,
  ],
};

describe('indexComponents', () => {
  const components = indexComponents(scene);
  const byLabel = (label: string) => components.find((c) => c.label === label)!;

  it('lists labelled components across nested diagrams, with where they sit', () => {
    expect(components.map((c) => c.label).sort()).toEqual([
      'API',
      'Auth Service',
      'Orders DB',
      'Web App',
    ]);
    expect(byLabel('Auth Service').path).toEqual(['Shop', 'API']);
    expect(byLabel('Web App').path).toEqual(['Shop']);
  });

  it('records connections both ways, with their labels', () => {
    expect(byLabel('Web App').outgoing).toEqual([{ to: 'API', label: 'REST' }]);
    expect(byLabel('API').incoming).toEqual([{ from: 'Web App', label: 'REST' }]);
    expect(byLabel('API').outgoing).toEqual([{ to: 'Orders DB' }]);
  });

  it('knows which code a portal stands for and what it drills into', () => {
    expect(byLabel('API').code).toEqual({ repo: 'acme/shop', path: 'apps/api' });
    expect(byLabel('API').drillsInto).toEqual({ diagramId: 'api-d', title: 'API' });
  });
});

describe('searchComponents', () => {
  const components = indexComponents(scene);

  it('ranks exact names above partial ones', () => {
    const results = searchComponents(components, 'api');
    expect(results[0].label).toBe('API');
  });

  it('finds the most specific component owning a file', () => {
    const results = searchComponents(components, 'apps/api/src/auth/login.ts');
    expect(results.map((r) => r.label)).toEqual(['Auth Service', 'API']);
  });

  it('matches multi-word queries in any order', () => {
    expect(searchComponents(components, 'db orders')[0].label).toBe('Orders DB');
  });

  it('returns nothing for unrelated queries', () => {
    expect(searchComponents(components, 'kafka')).toEqual([]);
  });
});

describe('componentForPath', () => {
  const components = indexComponents(scene);

  it('picks the deepest folder that contains the file', () => {
    expect(componentForPath(components, 'apps/api/src/auth/session.ts')?.label).toBe(
      'Auth Service',
    );
    expect(componentForPath(components, '/apps/api/src/routes/orders.ts')?.label).toBe('API');
  });

  it('does not match folders that only share a prefix', () => {
    expect(componentForPath(components, 'apps/api-gateway/index.ts')).toBeNull();
  });
});

describe('describeComponent', () => {
  it('reads like a short card', () => {
    const api = indexComponents(scene).find((c) => c.label === 'API')!;
    const text = describeComponent(api);
    expect(text).toContain('**API** (portal) — in Shop');
    expect(text).toContain('code: acme/shop @ apps/api');
    expect(text).toContain('connects to: "Orders DB"');
    expect(text).toContain('used by: "Web App" (REST)');
  });
});

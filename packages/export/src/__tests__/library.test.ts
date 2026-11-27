import { describe, it, expect } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import {
  CATALOG,
  catalogFor,
  cylinderPaths,
  iconById,
  iconPlacement,
  queuePaths,
  searchCatalog,
} from '../library';
import { renderSvgMarkup } from '../svgMarkup';

const base = {
  diagramId: 'd',
  angle: 0,
  opacity: 100,
  strokeColor: '#c2410c',
  backgroundColor: '#fff7ed',
  fillStyle: 'solid',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 1,
  seed: 7,
  renderMode: 'clean',
  layerId: 'default',
  groupIds: [],
  isLocked: false,
  isDeleted: false,
  boundElements: [],
  version: 1,
  updatedAt: 1,
};
const el = (extra: Record<string, unknown>) => ({ ...base, ...extra }) as unknown as MavisElement;

describe('icons', () => {
  it('are found by id, and nothing else is', () => {
    expect(iconById('database')?.paths.length).toBeGreaterThan(0);
    for (const id of ['nope', 'constructor', '__proto__', 'toString', 42, null]) {
      expect(iconById(id)).toBeNull();
    }
  });

  it('sit inside the shape: on a cylinder’s lid, clear of its label', () => {
    const at = iconPlacement({ type: 'cylinder', width: 160, height: 100 })!;
    const { ry } = cylinderPaths(160, 100);
    // Centred in the top ellipse
    expect(at.x + at.size / 2).toBe(80);
    expect(at.y + at.size / 2).toBeCloseTo(ry);
    expect(at.y + at.size).toBeLessThan(ry * 2 + 4);
    expect(iconPlacement({ type: 'rectangle', width: 10, height: 10 })).toBeNull();
  });
});

describe('the catalog', () => {
  it('only uses icons that exist, with unique ids', () => {
    for (const entry of CATALOG) expect(iconById(entry.icon), entry.id).not.toBeNull();
    expect(new Set(CATALOG.map((e) => e.id)).size).toBe(CATALOG.length);
  });

  it('knows what a technology looks like', () => {
    expect(catalogFor('PostgreSQL')).toMatchObject({ id: 'generic-database', shape: 'cylinder' });
    expect(catalogFor('redis')).toMatchObject({ id: 'generic-cache', shape: 'cylinder' });
    expect(catalogFor('kafka')).toMatchObject({ shape: 'queue', kind: 'queue' });
    expect(catalogFor('RabbitMQ')).toMatchObject({ id: 'generic-queue' });
    expect(catalogFor('Stripe')).toMatchObject({ id: 'generic-payments', kind: 'external' });
    expect(catalogFor('aws s3')).toMatchObject({ id: 'aws-s3', provider: 'aws' });
    expect(catalogFor('Google Cloud SQL')).toMatchObject({ id: 'gcp-cloud-sql' });
    expect(catalogFor('frobnicator')).toBeNull();
  });

  it('searches by name, provider and keyword, best first', () => {
    expect(searchCatalog('s3')[0].id).toBe('aws-s3');
    expect(searchCatalog('azure redis')[0].id).toBe('azure-cache-for-redis');
    expect(searchCatalog('kubernetes').some((e) => e.id === 'kubernetes-pod')).toBe(true);
    expect(searchCatalog('').length).toBe(CATALOG.length);
    expect(searchCatalog('zzzz')).toEqual([]);
  });
});

describe('drawing them as SVG', () => {
  it('draws cylinders and queues with their rims, in both modes', () => {
    const db = el({ id: 'db', type: 'cylinder', x: 0, y: 0, width: 160, height: 100 });
    const q = el({ id: 'q', type: 'queue', x: 200, y: 0, width: 180, height: 70 });
    const clean = renderSvgMarkup([db, q]);
    expect(clean).toContain(cylinderPaths(160, 100).rim);
    expect(clean).toContain(queuePaths(180, 70).rim);
    const sketchy = renderSvgMarkup([db, q], { renderMode: 'sketchy' });
    expect(sketchy.match(/<path/g)!.length).toBeGreaterThan(4);
  });

  it('draws a known icon in the shape’s colour, and ignores anything else', () => {
    const svg = renderSvgMarkup([
      el({
        id: 'a',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 160,
        height: 90,
        roundness: 0,
        icon: 'server',
      }),
      el({
        id: 'b',
        type: 'rectangle',
        x: 0,
        y: 120,
        width: 160,
        height: 90,
        roundness: 0,
        icon: '"><script>',
      }),
    ]);
    expect(svg).toContain(iconById('server')!.paths[0]);
    expect(svg).toContain('stroke="#c2410c" stroke-width="2" stroke-linecap="round"');
    expect(svg).not.toMatch(/<script/i);
    expect(svg.match(/stroke-linecap="round" stroke-linejoin="round">/g)).toHaveLength(1);
  });
});

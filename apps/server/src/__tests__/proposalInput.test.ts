import { describe, it, expect } from 'vitest';
import { buildProjectModel, indexComponents } from '@mavisdraw/llm';
import { buildProposal } from '../services/proposalInput.js';
import { shopScene } from './fixtures/scene.js';

const root = indexComponents(shopScene()).filter((c) => c.diagramId === 'root');

describe('buildProposal', () => {
  it('maps kinds to shapes and resolves names case-insensitively', () => {
    const result = buildProposal(
      {
        description: '  Add a cache  ',
        add: [{ name: 'Redis', kind: 'datastore' }],
        connect: [{ from: 'api', to: 'redis', label: ' reads ' }],
      },
      root,
    );
    expect(result).toEqual({
      ok: true,
      proposal: {
        description: 'Add a cache',
        changes: [{ action: 'add', elementType: 'ellipse', label: 'Redis' }],
        connections: [{ fromLabel: 'API', toLabel: 'Redis', label: 'reads' }],
      },
    });
  });

  it('turns renames and removals into edits of the exact elements', () => {
    const result = buildProposal(
      {
        description: 'Tidy up',
        rename: [{ component: 'Orders DB', to: 'Orders (Postgres)' }],
        remove: [{ component: 'Web App' }],
      },
      root,
    );
    expect(result.ok && result.proposal.changes).toEqual([
      { action: 'modify', elementId: 'db', label: 'Orders (Postgres)' },
      { action: 'delete', elementId: 'web' },
    ]);
  });

  it('refuses to add what already exists', () => {
    const result = buildProposal({ description: 'x', add: [{ name: 'api' }] }, root);
    expect(result).toEqual({
      ok: false,
      error: '"api" is already on this diagram; connect to it instead of adding it.',
    });
  });

  it('lists the available names when one is unknown', () => {
    const result = buildProposal({ description: 'x', remove: [{ component: 'Billing' }] }, root);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No component "Billing" to remove.');
      expect(result.error).toContain('Components in this diagram: "Web App", "API", "Orders DB".');
    }
  });

  it('needs at least one change', () => {
    expect(buildProposal({ description: 'x' }, root).ok).toBe(false);
  });

  it('rejects self-connections', () => {
    const result = buildProposal({ description: 'x', connect: [{ from: 'API', to: 'api' }] }, root);
    expect(result).toEqual({ ok: false, error: '"API" can\'t connect to itself.' });
  });

  it('without the model, does not let components from other diagrams be targeted', () => {
    const result = buildProposal(
      { description: 'x', connect: [{ from: 'API', to: 'Auth Service' }] },
      root,
    );
    expect(result.ok).toBe(false);
  });
});

describe('buildProposal with the architecture model', () => {
  const model = buildProjectModel(shopScene());

  it('adding a component drawn elsewhere shows the same one here, not a duplicate', () => {
    const result = buildProposal({ description: 'x', add: [{ name: 'orders' }] }, root, model);
    expect(result).toMatchObject({
      ok: true,
      proposal: {
        changes: [
          {
            action: 'add',
            elementType: 'rectangle',
            label: 'Orders',
            componentId: 'orders',
            drawnOn: 'Shop › API internals',
          },
        ],
      },
    });
  });

  it('connecting to a component on another level records the relationship', () => {
    const result = buildProposal(
      {
        description: 'x',
        add: [{ name: 'Cache' }],
        connect: [
          { from: 'Web App', to: 'Orders', label: 'places orders' },
          { from: 'Cache', to: 'orders' },
        ],
      },
      root,
      model,
    );
    expect(result.ok && result.proposal.connections).toEqual([
      {
        fromLabel: 'Web App',
        toLabel: 'Orders',
        label: 'places orders',
        fromComponentId: 'web',
        toComponentId: 'orders',
      },
      // The new shape's id is only known once it's applied
      { fromLabel: 'Cache', toLabel: 'Orders', toComponentId: 'orders' },
    ]);
  });

  it('component ids work for what is on this diagram too (drawn, not recorded)', () => {
    const result = buildProposal(
      { description: 'x', connect: [{ from: 'web', to: 'db' }] },
      root,
      model,
    );
    expect(result.ok && result.proposal.connections).toEqual([
      { fromLabel: 'Web App', toLabel: 'Orders DB' },
    ]);
  });

  it('names nothing in the whole map: says so', () => {
    const result = buildProposal(
      { description: 'x', connect: [{ from: 'API', to: 'Kafka' }] },
      root,
      model,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('anywhere in the map');
  });
});

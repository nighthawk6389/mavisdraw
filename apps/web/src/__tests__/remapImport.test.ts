import { describe, it, expect } from 'vitest';
import type { Diagram, MavisElement } from '@mavisdraw/types';
import { remapImport } from '../import/remapImport';

/** An imported file's content brought into the open project (ImportHandler). */

const diagram = (
  id: string,
  parentDiagramId: string | null,
  parentPortalId: string | null = null,
) =>
  ({
    id,
    projectId: 'source-project',
    parentDiagramId,
    parentPortalId,
    title: id,
    createdBy: 'someone-else',
  }) as Diagram;

const el = (id: string, diagramId: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'rectangle',
    diagramId,
    groupIds: [],
    boundElements: [],
    version: 3,
    ...extra,
  }) as unknown as MavisElement;

const target = { id: 'here', projectId: 'my-project', createdBy: 'me' };

let n = 0;
const ids = () => `new${++n}`;

describe('remapImport', () => {
  // Source map: root (box + portal → nested) and nested (arrow from a to b, with a label)
  const file = {
    rootDiagramId: 'src-root',
    diagrams: [diagram('src-root', null), diagram('src-nested', 'src-root', 'portal')],
    elements: [
      el('box', 'src-root', { groupIds: ['g1'] }),
      el('portal', 'src-root', { type: 'portal', targetDiagramId: 'src-nested', groupIds: ['g1'] }),
      el('a', 'src-nested', { boundElements: [{ id: 'arrow', type: 'arrow' }] }),
      el('b', 'src-nested', { boundElements: [{ id: 'arrow', type: 'arrow' }] }),
      el('arrow', 'src-nested', {
        type: 'arrow',
        startBinding: { elementId: 'a', gap: 4 },
        endBinding: { elementId: 'gone', gap: 4 },
        boundElements: [{ id: 'label', type: 'text' }],
      }),
      el('label', 'src-nested', { type: 'text', containerId: 'arrow' }),
    ],
  };

  it('puts the top level on screen and nested diagrams in this project, all with new ids', () => {
    const out = remapImport(file, target, ids);
    expect(out.diagrams).toHaveLength(1);
    const nested = out.diagrams[0];
    expect(nested).toMatchObject({
      projectId: 'my-project',
      parentDiagramId: 'here',
      createdBy: 'me',
    });
    expect(nested.id).not.toBe('src-nested');

    const byOld = new Map(file.elements.map((e, i) => [e.id, out.elements[i]]));
    expect(byOld.get('box')!.diagramId).toBe('here');
    expect(byOld.get('a')!.diagramId).toBe(nested.id);
    // No id survives: a second import of the same file can't collide with the first
    for (const e of out.elements) expect(file.elements.map((f) => f.id)).not.toContain(e.id);
  });

  it('rewires portals, bindings, labels and groups to the new ids', () => {
    const out = remapImport(file, target, ids);
    const byOld = new Map(
      file.elements.map((e, i) => [e.id, out.elements[i] as unknown as Record<string, unknown>]),
    );
    const nested = out.diagrams[0];
    const id = (old: string) => byOld.get(old)!.id;

    expect(byOld.get('portal')!.targetDiagramId).toBe(nested.id);
    expect(nested.parentPortalId).toBe(id('portal'));
    expect(byOld.get('arrow')!.startBinding).toEqual({ elementId: id('a'), gap: 4 });
    // A binding to something not in the file is dropped, not left dangling
    expect(byOld.get('arrow')!.endBinding).toBeNull();
    expect(byOld.get('arrow')!.boundElements).toEqual([{ id: id('label'), type: 'text' }]);
    expect(byOld.get('a')!.boundElements).toEqual([{ id: id('arrow'), type: 'arrow' }]);
    expect(byOld.get('label')!.containerId).toBe(id('arrow'));
    // Grouped shapes stay grouped together, under a new group id
    const [g] = byOld.get('box')!.groupIds as string[];
    expect(g).not.toBe('g1');
    expect(byOld.get('portal')!.groupIds).toEqual([g]);
  });

  it('files without a root id: diagrams without a parent are the top level', () => {
    const out = remapImport(
      { diagrams: [diagram('only', null)], elements: [el('x', 'only'), el('stray', 'unknown')] },
      target,
      ids,
    );
    expect(out.diagrams).toEqual([]);
    expect(out.elements.map((e) => e.diagramId)).toEqual(['here', 'here']);
  });

  it('leaves the file’s own objects alone', () => {
    const before = JSON.stringify(file);
    remapImport(file, target, ids);
    expect(JSON.stringify(file)).toBe(before);
  });
});

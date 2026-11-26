import { describe, it, expect, beforeEach } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import { useElementsStore } from '../stores/elementsStore';
import { diffDiagrams, highlightBounds, summarize } from '../versions/diff';

const D = 'd1';
let n = 0;
const make = (type: 'rectangle' | 'arrow' | 'text' | 'portal', extra: Partial<MavisElement> = {}) =>
  ({
    ...useElementsStore.getState().createElement(type, D, 0, 0, 100, 50),
    id: `e${++n}`,
    ...extra,
  }) as MavisElement;

describe('version diff', () => {
  beforeEach(() => {
    n = 0;
  });

  it('lists added, removed and changed shapes', () => {
    const kept = make('rectangle');
    const gone = make('rectangle');
    const before = [kept, gone];
    const fresh = make('rectangle');
    const after = [{ ...kept, x: 300, version: 5 } as MavisElement, fresh];
    const diff = diffDiagrams(before, after);
    expect(summarize(diff)).toBe('1 added · 1 removed · 1 changed');
    expect(diff.changes.map((c) => [c.kind, c.id, c.details])).toEqual([
      ['added', fresh.id, []],
      ['changed', kept.id, ['Moved']],
      ['removed', gone.id, []],
    ]);
  });

  it('folds labels into their shape and explains renames', () => {
    const box = make('rectangle');
    const label = make('text', { containerId: box.id, text: 'Auth' } as Partial<MavisElement>);
    const renamed = { ...label, text: 'Auth Service', version: 3 } as MavisElement;
    const diff = diffDiagrams([box, label], [box, renamed]);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toMatchObject({
      id: box.id,
      name: 'Auth Service',
      details: ['Renamed “Auth” → “Auth Service”'],
    });
  });

  it('describes style, connection and lock changes; ignores bookkeeping', () => {
    const box = make('rectangle');
    const diff = diffDiagrams(
      [box],
      [
        {
          ...box,
          strokeColor: '#e03131',
          isLocked: true,
          version: 9,
          updatedAt: 1,
          seed: 7,
        } as MavisElement,
      ],
    );
    expect(diff.changes[0].details).toEqual(['Restyled', 'Locked']);
    expect(
      diffDiagrams([box], [{ ...box, version: 99, updatedAt: 5 } as MavisElement]).changes,
    ).toEqual([]);

    const arrow = make('arrow', {
      points: [
        [0, 0],
        [100, 0],
      ],
    } as Partial<MavisElement>);
    const rebound = {
      ...arrow,
      endBinding: { elementId: box.id, focus: 0, gap: 4 },
    } as unknown as MavisElement;
    expect(diffDiagrams([arrow], [rebound]).changes[0].details).toEqual(['Reconnected']);
  });

  it('treats soft-deleted elements as gone', () => {
    const box = make('rectangle');
    const diff = diffDiagrams([box], [{ ...box, isDeleted: true } as MavisElement]);
    expect(diff.changes.map((c) => c.kind)).toEqual(['removed']);
  });

  it('highlights arrows by their points, shapes by their box', () => {
    const arrow = make('arrow', {
      x: 10,
      y: 20,
      points: [
        [0, 0],
        [50, -10],
      ],
    } as Partial<MavisElement>);
    expect(highlightBounds(arrow)).toEqual({ x: 10, y: 10, width: 50, height: 10 });
    expect(highlightBounds(make('rectangle', { x: 5, y: 6 }))).toEqual({
      x: 5,
      y: 6,
      width: 100,
      height: 50,
    });
  });
});

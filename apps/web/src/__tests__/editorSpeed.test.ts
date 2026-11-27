import { describe, it, expect } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import { diffElementMaps } from '../stores/history';
import { selectionStyleKey } from '../components/toolbar/StylePanel';

const el = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    strokeColor: '#000',
    boundElements: [],
    version: 1,
    ...extra,
  }) as unknown as MavisElement;

describe('what changed in one store update', () => {
  it('finds added, changed and removed elements', () => {
    const a = el('a');
    const b = el('b');
    const prev = new Map([
      ['a', a],
      ['b', b],
    ]);
    const next = new Map([
      ['a', { ...a, x: 5 } as MavisElement],
      ['c', el('c')],
    ]);
    expect([...diffElementMaps(prev, next)].sort()).toEqual(['a', 'b', 'c']);
    // Same size, one swapped for another: the removal is still found
    const swapped = new Map([
      ['a', a],
      ['d', el('d')],
    ]);
    expect([...diffElementMaps(prev, swapped)].sort()).toEqual(['b', 'd']);
  });

  it('is worked out once per update, whoever asks', () => {
    const prev = new Map([['a', el('a')]]);
    const next = new Map([['a', el('a', { x: 1 })]]);
    expect(diffElementMaps(prev, next)).toBe(diffElementMaps(prev, next));
    // A different "before" for the same map is worked out again
    const other = new Map<string, MavisElement>();
    expect([...diffElementMaps(other, next)]).toEqual(['a']);
  });
});

describe('what the style panel shows of a selection', () => {
  const selected = new Set(['box']);
  const label = el('label', { type: 'text', text: 'API', fontSize: 20, containerId: 'box' });
  const box = el('box', { boundElements: [{ id: 'label', type: 'text' }] });
  const scene = (b: MavisElement, t: MavisElement) =>
    new Map([
      ['box', b],
      ['label', t],
    ]);

  it('doesn’t change while the selection moves or resizes', () => {
    const before = selectionStyleKey(scene(box, label), selected);
    const moved = { ...box, x: 300, y: 40, width: 80, version: 9 } as MavisElement;
    const movedLabel = { ...label, x: 310, y: 50, version: 4 } as MavisElement;
    expect(selectionStyleKey(scene(moved, movedLabel), selected)).toBe(before);
  });

  it('changes when its look, or its label’s, does', () => {
    const before = selectionStyleKey(scene(box, label), selected);
    expect(
      selectionStyleKey(scene({ ...box, strokeColor: '#f00' } as MavisElement, label), selected),
    ).not.toBe(before);
    expect(
      selectionStyleKey(scene(box, { ...label, fontSize: 28 } as MavisElement), selected),
    ).not.toBe(before);
  });
});

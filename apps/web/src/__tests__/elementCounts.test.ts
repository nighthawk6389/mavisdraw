import { describe, it, expect } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import { elementCountsKey } from '../components/navigation/DiagramTreeSidebar';

/** The diagram tree's counts, worked out on every store change (each move of a drag). */
const el = (id: string, diagramId: string, extra: Partial<MavisElement> = {}) =>
  ({ id, diagramId, isDeleted: false, x: 0, ...extra }) as MavisElement;

describe('element counts per diagram', () => {
  it('stay right through moves, additions, deletions and moves between diagrams', () => {
    let map = new Map([
      ['a', el('a', 'd1')],
      ['b', el('b', 'd1')],
      ['c', el('c', 'd2')],
    ]);
    expect(elementCountsKey(map)).toBe('d1:2|d2:1');

    // A drag: only positions change
    for (let x = 1; x <= 3; x++) {
      map = new Map(map).set('a', el('a', 'd1', { x }));
      expect(elementCountsKey(map)).toBe('d1:2|d2:1');
    }
    map = new Map(map).set('d', el('d', 'd2'));
    expect(elementCountsKey(map)).toBe('d1:2|d2:2');
    map = new Map(map).set('b', el('b', 'd1', { isDeleted: true }));
    expect(elementCountsKey(map)).toBe('d1:1|d2:2');
    map = new Map(map).set('a', el('a', 'd3'));
    expect(elementCountsKey(map)).toBe('d2:2|d3:1');
    const removed = new Map(map);
    removed.delete('c');
    expect(elementCountsKey(removed)).toBe('d2:1|d3:1');
    // An unrelated map (another project) is counted from scratch
    expect(elementCountsKey(new Map([['z', el('z', 'other')]]))).toBe('other:1');
  });
});

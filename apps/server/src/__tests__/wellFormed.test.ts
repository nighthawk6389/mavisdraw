import { describe, it, expect } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import { wellFormed } from '../services/projectService.js';

/** Elements as clients stored them, made safe for everything that reads a scene. */
describe('elements loaded into a scene', () => {
  const el = (extra: Record<string, unknown>) =>
    ({
      id: 'e1',
      type: 'rectangle',
      diagramId: 'd1',
      boundElements: [],
      ...extra,
    }) as unknown as MavisElement;

  it('are on the diagram they were stored in, whatever they claim', () => {
    expect(wellFormed(el({ diagramId: 'someone-elses' }), 'd1').diagramId).toBe('d1');
  });

  it('get arrays where arrays are read', () => {
    expect(wellFormed(el({ boundElements: undefined }), 'd1').boundElements).toEqual([]);
    const arrow = wellFormed(el({ type: 'arrow', points: 'nope' }), 'd1') as unknown as {
      points: unknown[];
    };
    expect(arrow.points).toEqual([]);
    const line = wellFormed(el({ type: 'line', points: [[0, 0], 'x', [5]] }), 'd1') as unknown as {
      points: unknown[];
    };
    expect(line.points).toEqual([[0, 0]]);
  });

  it('are returned as they are when nothing needs fixing (no copies in big scenes)', () => {
    const fine = el({
      type: 'arrow',
      points: [
        [0, 0],
        [10, 10],
      ],
    });
    expect(wellFormed(fine, 'd1')).toBe(fine);
  });
});

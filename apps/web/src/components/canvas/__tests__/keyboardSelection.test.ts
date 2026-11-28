import { describe, it, expect } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import { describeSelection, nextTabStop, tabbableShapes } from '../keyboardSelection';

const el = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'rectangle',
    isDeleted: false,
    boundElements: [],
    ...extra,
  }) as unknown as MavisElement;

describe('Tab through the shapes', () => {
  const shapes = tabbableShapes([
    el('a'),
    el('a-label', { type: 'text', containerId: 'a', text: 'API' }),
    el('b'),
    el('gone', { isDeleted: true }),
    el('c'),
  ]);

  it('visits shapes, not their labels or deleted ones', () => {
    expect(shapes.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('starts at the first (or last), moves along, and lets go past the end', () => {
    expect(nextTabStop(shapes, new Set(), false)).toBe('a');
    expect(nextTabStop(shapes, new Set(), true)).toBe('c');
    expect(nextTabStop(shapes, new Set(['a']), false)).toBe('b');
    expect(nextTabStop(shapes, new Set(['b']), true)).toBe('a');
    // Past the last (or before the first): leave the canvas
    expect(nextTabStop(shapes, new Set(['c']), false)).toBeNull();
    expect(nextTabStop(shapes, new Set(['a']), true)).toBeNull();
    expect(nextTabStop([], new Set(), false)).toBeNull();
  });
});

describe('what a screen reader hears', () => {
  it('names the shape and its label, or counts a multi-selection', () => {
    const box = el('a', { boundElements: [{ id: 'a-label', type: 'text' }] });
    const label = el('a-label', { type: 'text', containerId: 'a', text: 'API' });
    const note = el('n', { type: 'text', text: 'A note' });
    const elements = new Map([
      ['a', box],
      ['a-label', label],
      ['n', note],
      ['p', el('p', { type: 'portal', label: 'Platform' })],
    ]);
    expect(describeSelection(elements, new Set(['a']))).toBe('Rectangle “API” selected');
    expect(describeSelection(elements, new Set(['n']))).toBe('Text “A note” selected');
    expect(describeSelection(elements, new Set(['a', 'n']))).toBe('2 shapes selected');
    expect(describeSelection(elements, new Set())).toBe('');
  });
});

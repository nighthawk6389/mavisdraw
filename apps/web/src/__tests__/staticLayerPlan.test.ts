import { describe, it, expect } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import {
  changedSince,
  liveSpan,
  MAX_LIVE_CHANGES,
  MAX_LIVE_SPAN,
} from '../components/canvas/staticLayerPlan';

const shape = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ...extra,
  }) as unknown as MavisElement;

describe('which shapes changed since the last frame', () => {
  it('is null when the list itself changed (added, removed, restacked)', () => {
    const a = shape('a');
    const b = shape('b');
    expect(changedSince(null, [a])).toBeNull();
    expect(changedSince([a], [a, b])).toBeNull();
    expect(changedSince([a, b], [b, a])).toBeNull();
  });

  it('is the shapes whose object changed, and nothing when none did', () => {
    const a = shape('a');
    const b = shape('b');
    expect(changedSince([a, b], [a, b])).toEqual(new Set());
    expect(changedSince([a, b], [a, { ...b, x: 5 } as MavisElement])).toEqual(new Set(['b']));
  });

  it('includes connectors bound to a changed shape, and those connectors’ labels', () => {
    const box = shape('box');
    const other = shape('other');
    const arrow = shape('arrow', {
      type: 'arrow',
      startBinding: { elementId: 'box' },
      endBinding: { elementId: 'other' },
    });
    const label = shape('label', { type: 'text', containerId: 'arrow' });
    const unrelated = shape('far', { type: 'arrow', startBinding: { elementId: 'other' } });
    const before = [box, other, arrow, label, unrelated];
    const after = [{ ...box, x: 50 } as MavisElement, other, arrow, label, unrelated];
    expect(changedSince(before, after)).toEqual(new Set(['box', 'arrow', 'label']));
  });
});

describe('what to draw live', () => {
  const list = Array.from({ length: 1000 }, (_, i) => shape(`s${i}`));

  it('spans from the lowest to the highest changing shape', () => {
    expect(liveSpan(list, new Set(['s40', 's12', 's30']))).toEqual({ from: 12, to: 40 });
  });

  it('draws everything when nothing, too much, or too wide a span is changing', () => {
    expect(liveSpan(list, new Set())).toBeNull();
    expect(liveSpan(list, new Set(['gone']))).toBeNull();
    expect(
      liveSpan(list, new Set(list.slice(0, MAX_LIVE_CHANGES + 1).map((s) => s.id))),
    ).toBeNull();
    expect(liveSpan(list, new Set(['s0', `s${MAX_LIVE_SPAN}`]))).toBeNull();
    expect(liveSpan(list, new Set(['s0', `s${MAX_LIVE_SPAN - 1}`]))).toEqual({
      from: 0,
      to: MAX_LIVE_SPAN - 1,
    });
  });
});

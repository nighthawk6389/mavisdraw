import { describe, it, expect, beforeEach } from 'vitest';
import type { LinearElement, MavisElement } from '@mavisdraw/types';
import { useElementsStore } from '../../stores/elementsStore';
import { findBindingTarget } from '../../components/canvas/HitTesting';

const D = 'diagram-1';
const store = () => useElementsStore.getState();
const get = (id: string) => store().elements.get(id)!;

function addRect(x: number, y: number, w = 100, h = 60): MavisElement {
  const el = store().createElement('rectangle', D, x, y, w, h);
  store().addElement(el);
  return el;
}

/** An arrow through the given absolute points, added to the store. */
function addArrow(points: [number, number][]): LinearElement {
  const [x, y] = points[0];
  const arrow = store().createElement('arrow', D, x, y, 1, 1) as LinearElement;
  const placed = { ...arrow, points: points.map(([px, py]) => [px - x, py - y]) } as LinearElement;
  store().addElement(placed);
  return placed;
}

const ends = (id: string) => {
  const a = get(id) as LinearElement;
  const first = a.points[0];
  const last = a.points[a.points.length - 1];
  return { start: [a.x + first[0], a.y + first[1]], end: [a.x + last[0], a.y + last[1]] };
};

beforeEach(() => {
  useElementsStore.setState({
    elements: new Map(),
    history: [],
    historyIndex: -1,
    clipboard: null,
  });
});

describe('which shape a connector end attaches to', () => {
  const rect = (id: string, x: number, y: number, w = 100, h = 60) =>
    ({
      id,
      type: 'rectangle',
      x,
      y,
      width: w,
      height: h,
      angle: 0,
      isDeleted: false,
    }) as unknown as MavisElement;

  it('anywhere over a shape attaches to it, on the outline (gap 0)', () => {
    expect(findBindingTarget(150, 130, [rect('a', 100, 100)])).toEqual({
      element: expect.objectContaining({ id: 'a' }),
      gap: 0,
    });
  });

  it('the topmost shape under the end wins (a box drawn inside a bigger one)', () => {
    const outer = rect('outer', 0, 0, 400, 300);
    const inner = rect('inner', 100, 100);
    expect(findBindingTarget(150, 130, [outer, inner])?.element.id).toBe('inner');
    expect(findBindingTarget(20, 20, [outer, inner])?.element.id).toBe('outer');
  });

  it('just outside attaches within the threshold it’s given (callers pass a screen distance)', () => {
    const a = rect('a', 100, 100);
    expect(findBindingTarget(210, 130, [a], new Set(), 16)?.gap).toBeCloseTo(10);
    expect(findBindingTarget(210, 130, [a], new Set(), 4)).toBeNull();
  });
});

describe('connector ends stay on the outline', () => {
  it('binding puts the end on the outline at once, not on the next move', () => {
    const a = addRect(0, 0);
    const b = addRect(300, 0);
    // Drawn from the middle of A to the middle of B
    const arrow = addArrow([
      [50, 30],
      [350, 30],
    ]);
    store().bindArrow(arrow.id, 'end', b.id, 0);
    store().bindArrow(arrow.id, 'start', a.id, 0);
    const { start, end } = ends(arrow.id);
    expect(start[0]).toBeCloseTo(100);
    expect(end[0]).toBeCloseTo(300);
    expect(start[1]).toBeCloseTo(30);
  });

  it('a bent connector keeps the side it arrives from when its shape moves', () => {
    const a = addRect(0, 0);
    const b = addRect(300, 200);
    // Out of A's right side, along, then down into B's top
    const arrow = addArrow([
      [100, 30],
      [350, 30],
      [350, 200],
    ]);
    store().bindArrow(arrow.id, 'start', a.id, 0);
    store().bindArrow(arrow.id, 'end', b.id, 0);
    store().updateElement(b.id, { x: 310 });
    const { end } = ends(arrow.id);
    // Still B's top edge (it aims at the bend above it, not at A)
    expect(end[1]).toBeCloseTo(200);
  });

  it('an elbow connector attaches through the sides that face each other', () => {
    const a = addRect(0, 0);
    const b = addRect(0, 300);
    const arrow = addArrow([
      [100, 30],
      [100, 330],
    ]);
    store().bindArrow(arrow.id, 'start', a.id, 0);
    store().bindArrow(arrow.id, 'end', b.id, 0);
    store().updateElement(arrow.id, { routingMode: 'elbow' } as Partial<LinearElement>);
    // Stacked: A's bottom middle to B's top middle
    expect(ends(arrow.id)).toEqual({ start: [50, 60], end: [50, 300] });

    // Moved beside it: left/right instead, so the route never crosses a shape
    store().updateElement(a.id, { x: -400, y: 280 });
    expect(ends(arrow.id)).toEqual({ start: [-300, 310], end: [0, 330] });
  });
});

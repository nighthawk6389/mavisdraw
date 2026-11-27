import { describe, it, expect, beforeEach } from 'vitest';
import type { LinearElement, MavisElement } from '@mavisdraw/types';
import { useElementsStore } from '../../stores/elementsStore';

const D = 'diagram-1';

function store() {
  return useElementsStore.getState();
}

function get(id: string): MavisElement {
  return store().elements.get(id)!;
}

function addRect(x: number, y: number, w = 100, h = 60): MavisElement {
  const el = store().createElement('rectangle', D, x, y, w, h);
  store().addElement(el);
  return el;
}

/** An arrow from the right side of `a` to the left side of `b`, bound at both ends. */
function connect(a: MavisElement, b: MavisElement): LinearElement {
  const arrow = store().createElement('arrow', D, a.x + a.width, a.y + a.height / 2, 0, 0) as LinearElement;
  arrow.points = [
    [0, 0],
    [b.x - (a.x + a.width), b.y + b.height / 2 - (a.y + a.height / 2)],
  ];
  store().addElement(arrow);
  store().bindArrow(arrow.id, 'start', a.id, 0);
  store().bindArrow(arrow.id, 'end', b.id, 0);
  return get(arrow.id) as LinearElement;
}

function endPoint(arrow: LinearElement, which: 'start' | 'end') {
  const p = which === 'start' ? arrow.points[0] : arrow.points[arrow.points.length - 1];
  return { x: arrow.x + p[0], y: arrow.y + p[1] };
}

describe('updateElementsSilent (one store change per pointer move)', () => {
  beforeEach(() => {
    useElementsStore.setState({ elements: new Map(), history: [], historyIndex: -1, clipboard: null });
  });

  it('applies every update in a single change notification', () => {
    const a = addRect(0, 0);
    const b = addRect(200, 0);
    let notifications = 0;
    const unsubscribe = useElementsStore.subscribe(() => notifications++);
    store().updateElementsSilent([
      { id: a.id, changes: { x: 10 } },
      { id: b.id, changes: { x: 210 } },
    ]);
    unsubscribe();
    expect(notifications).toBe(1);
    expect(get(a.id).x).toBe(10);
    expect(get(b.id).x).toBe(210);
  });

  it('opens no undo step of its own: a gesture batch owns it', () => {
    const a = addRect(0, 0);
    const before = store().history.length;
    store().beginHistoryBatch();
    for (let i = 1; i <= 5; i++) store().updateElementsSilent([{ id: a.id, changes: { x: i * 10 } }]);
    store().endHistoryBatch();
    expect(store().history.length).toBe(before + 1);
    store().undo();
    expect(get(a.id).x).toBe(0);
  });

  it('keeps labels inside their moving shape', () => {
    const a = addRect(0, 0, 160, 80);
    const label = store().createBoundText(a.id, 'Auth');
    store().updateElementsSilent([{ id: a.id, changes: { x: 300, y: 200 } }]);
    expect(get(label.id)).toMatchObject({ x: 310, y: 210 });
  });

  it('keeps arrows attached to a moving shape', () => {
    const a = addRect(0, 0);
    const b = addRect(300, 0);
    const arrow = connect(a, b);
    store().updateElementsSilent([{ id: b.id, changes: { y: 200 } }]);
    const moved = get(arrow.id) as LinearElement;
    expect(endPoint(moved, 'start')).toEqual(endPoint(arrow, 'start'));
    expect(endPoint(moved, 'end').y).toBeGreaterThan(150);
  });

  it('a selected arrow moving with one shape stays glued to the shape that stayed put', () => {
    const a = addRect(0, 0);
    const b = addRect(300, 0);
    const arrow = connect(a, b);
    // Drag a and the arrow together (as a marquee that caught both would)
    store().updateElementsSilent([
      { id: a.id, changes: { y: 200 } },
      { id: arrow.id, changes: { y: arrow.y + 200 } },
    ]);
    const moved = get(arrow.id) as LinearElement;
    // Start follows a; the end is still on b's outline (facing a's new position)
    const start = endPoint(moved, 'start');
    expect(start.y).toBeGreaterThan(200);
    expect(start.y).toBeLessThan(260);
    const end = endPoint(moved, 'end');
    const onOutline =
      Math.min(Math.abs(end.x - 300), Math.abs(end.x - 400), Math.abs(end.y - 0), Math.abs(end.y - 60)) < 0.001;
    expect(onOutline).toBe(true);
    expect(end.x).toBeGreaterThanOrEqual(300);
    expect(end.y).toBeLessThanOrEqual(60);
  });
});

describe('duplicateElements with an offset', () => {
  beforeEach(() => {
    useElementsStore.setState({ elements: new Map(), history: [], historyIndex: -1, clipboard: null });
  });

  it('copies in place for an Alt-drag, labels included', () => {
    const a = addRect(40, 40);
    store().createBoundText(a.id, 'Queue');
    const copies = store().duplicateElements([a.id], { x: 0, y: 0 });
    expect(copies).toHaveLength(2);
    const shape = copies.find((c) => c.type === 'rectangle')!;
    expect(shape).toMatchObject({ x: 40, y: 40 });
    expect(shape.id).not.toBe(a.id);
  });

  it('defaults to a 10px nudge (Ctrl+D)', () => {
    const a = addRect(40, 40);
    const [copy] = store().duplicateElements([a.id]);
    expect(copy).toMatchObject({ x: 50, y: 50 });
  });
});

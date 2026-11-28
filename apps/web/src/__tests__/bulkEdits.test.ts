import { describe, it, expect, beforeEach } from 'vitest';
import type { LinearElement, MavisElement } from '@mavisdraw/types';
import { useElementsStore } from '../stores/elementsStore';
import { useSelectionStore } from '../stores/selectionStore';
import { nudgeSelection } from '../hooks/useKeyboard';
import { computeElbowPoints } from '../components/canvas/HitTesting';

const D = 'diagram-1';
const store = () => useElementsStore.getState();
const get = (id: string) => store().elements.get(id)!;

function addRect(x: number, y: number): MavisElement {
  const el = store().createElement('rectangle', D, x, y, 100, 60);
  store().addElement(el);
  return el;
}

beforeEach(() => {
  useElementsStore.setState({
    elements: new Map(),
    history: [],
    historyIndex: -1,
    clipboard: null,
  });
  useSelectionStore.getState().clearSelection();
});

describe('nudging a selection', () => {
  it('moves everything selected in one store update; labels come along', () => {
    const shapes = Array.from({ length: 50 }, (_, i) => addRect(i * 150, 0));
    const label = store().createBoundText(shapes[0].id, 'API');
    useSelectionStore.getState().selectMultiple(shapes.map((s) => s.id));
    let updates = 0;
    const unsubscribe = useElementsStore.subscribe((s, prev) => {
      if (s.elements !== prev.elements) updates++;
    });
    nudgeSelection(10, 0);
    unsubscribe();
    expect(updates).toBe(1);
    expect(get(shapes[49].id).x).toBe(49 * 150 + 10);
    expect(get(label.id).x).toBeCloseTo(label.x + 10);
  });

  it('a selected connector stays attached to a shape that isn’t selected', () => {
    const a = addRect(0, 0);
    const b = addRect(300, 0);
    const arrow = store().createElement('arrow', D, 100, 30, 200, 0) as LinearElement;
    store().addElement(arrow);
    store().bindArrow(arrow.id, 'start', a.id, 0);
    store().bindArrow(arrow.id, 'end', b.id, 0);
    useSelectionStore.getState().selectMultiple([a.id, arrow.id]);
    nudgeSelection(0, 20);
    const after = get(arrow.id) as LinearElement;
    const end = after.points[after.points.length - 1];
    // The end is still on B's left edge, which didn't move
    expect(after.x + end[0]).toBeCloseTo(300);
  });

  it('is one undo step however many times it’s pressed', () => {
    const a = addRect(0, 0);
    useSelectionStore.getState().selectMultiple([a.id]);
    const steps = store().history.length;
    nudgeSelection(1, 0);
    nudgeSelection(1, 0);
    nudgeSelection(1, 0);
    expect(store().history.length).toBe(steps + 1);
    store().undo();
    expect(get(a.id).x).toBe(0);
  });
});

describe('elbow routes', () => {
  const shape = (id: string, x: number, y: number) =>
    ({ id, type: 'rectangle', x, y, width: 100, height: 60, angle: 0 }) as unknown as MavisElement;

  it('are worked out once per connector and shapes, and again when one of them changes', () => {
    const a = shape('a', 0, 0);
    const b = shape('b', 300, 200);
    const elbow = {
      id: 'e',
      type: 'arrow',
      x: 100,
      y: 30,
      points: [
        [0, 0],
        [200, 200],
      ],
      routingMode: 'elbow',
      startBinding: { elementId: 'a', gap: 0 },
      endBinding: { elementId: 'b', gap: 0 },
    } as unknown as LinearElement;
    const map = new Map<string, MavisElement>([
      ['a', a],
      ['b', b],
    ]);
    const first = computeElbowPoints(elbow, map);
    expect(computeElbowPoints(elbow, map)).toBe(first);
    map.set('b', { ...b, x: 310 } as MavisElement);
    expect(computeElbowPoints(elbow, map)).not.toBe(first);
  });
});

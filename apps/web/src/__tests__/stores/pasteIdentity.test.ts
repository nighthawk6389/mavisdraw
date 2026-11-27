import { describe, it, expect, beforeEach } from 'vitest';
import type { MavisElement, PortalElement, TextElement } from '@mavisdraw/types';
import { componentKeyOf } from '@mavisdraw/llm';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';

/**
 * Identity rules for copies (docs/model-layer.md): a copy on another diagram
 * shows the same component; a second copy on the same diagram is a new one.
 */

const store = () => useElementsStore.getState();
const all = () => store().elements;

function labelled(diagramId: string, label: string, componentId?: string): MavisElement {
  const shape = store().createElement('rectangle', diagramId, 0, 0, 120, 60);
  if (componentId) shape.componentId = componentId;
  const text = store().createElement('text', diagramId, 0, 0, 10, 10) as TextElement;
  text.text = label;
  text.containerId = shape.id;
  shape.boundElements = [{ id: text.id, type: 'text' }];
  store().addElement(shape);
  store().addElement(text);
  return shape;
}

function keyOf(el: MavisElement) {
  return componentKeyOf(all().get(el.id)!, all());
}

/** The pasted shape (not its label). */
function pastedShape(pasted: MavisElement[]) {
  return pasted.find((e) => e.type !== 'text')!;
}

beforeEach(() => {
  useElementsStore.setState({
    elements: new Map(),
    history: [],
    historyIndex: -1,
    clipboard: null,
  });
  useDiagramStore.setState((s) => ({
    diagrams: new Map([
      ...s.diagrams,
      ['d1', { ...s.diagrams.values().next().value!, id: 'd1', title: 'One' }],
      ['d2', { ...s.diagrams.values().next().value!, id: 'd2', title: 'Two' }],
      ['detail', { ...s.diagrams.values().next().value!, id: 'detail', title: 'Inside' }],
    ]),
  }));
});

describe('copies and components', () => {
  it('a copy on another diagram is the same component (legacy shapes too)', () => {
    const pg = labelled('d1', 'Postgres'); // drawn before the model: keyed by its own id
    store().copyElements([pg.id]);
    const copy = pastedShape(store().pasteElements('d2'));
    expect(copy.componentId).toBe(pg.id);
    expect(keyOf(copy)).toBe(keyOf(pg));
  });

  it('a duplicate on the same diagram is a new component', () => {
    const api = labelled('d1', 'API', 'c-api');
    const dup = pastedShape(store().duplicateElements([api.id]));
    expect(keyOf(dup)).not.toBe('c-api');
    expect(keyOf(dup)).toBe(dup.id);
  });

  it('pasting twice into another diagram: only the first copy is the same component', () => {
    const api = labelled('d1', 'API', 'c-api');
    store().copyElements([api.id]);
    const first = pastedShape(store().pasteElements('d2'));
    const second = pastedShape(store().pasteElements('d2'));
    expect(keyOf(first)).toBe('c-api');
    expect(keyOf(second)).not.toBe('c-api');
  });

  it('cut and paste in the same diagram keeps the component (it moved)', () => {
    const api = labelled('d1', 'API', 'c-api');
    store().copyElements([api.id]);
    store().deleteElements([api.id]);
    const moved = pastedShape(store().pasteElements('d1'));
    expect(keyOf(moved)).toBe('c-api');
  });

  it('unlabelled shapes stay plain drawing', () => {
    const box = store().createElement('rectangle', 'd1', 0, 0, 50, 50);
    store().addElement(box);
    store().copyElements([box.id]);
    const copy = pastedShape(store().pasteElements('d2'));
    expect(copy.componentId).toBeUndefined();
    expect(keyOf(copy)).toBeNull();
  });

  it('a portal copied to another diagram still opens the same diagram', () => {
    const portal = store().createElement('portal', 'd1', 0, 0, 160, 100) as PortalElement;
    portal.label = 'Payments';
    portal.targetDiagramId = 'detail';
    store().addElement(portal);
    store().copyElements([portal.id]);
    const elsewhere = pastedShape(store().pasteElements('d2')) as PortalElement;
    expect(elsewhere.targetDiagramId).toBe('detail');
    expect(keyOf(elsewhere)).toBe(portal.id);
    // …but a second door on the same diagram is a new, empty one
    const twin = pastedShape(store().duplicateElements([portal.id])) as PortalElement;
    expect(twin.targetDiagramId).toBe('');
    // …and a door into a diagram this project doesn't have opens nothing
    store().copyElements([portal.id]);
    const envelope = store().clipboard!;
    store().setClipboardFromEnvelope({
      type: 'mavisdraw-clipboard',
      elements: envelope.elements.map((e) =>
        e.type === 'portal' ? ({ ...e, targetDiagramId: 'other-project' } as MavisElement) : e,
      ),
    });
    const foreign = pastedShape(store().pasteElements('d2')) as PortalElement;
    expect(foreign.targetDiagramId).toBe('');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MavisElement, ProjectModel, TextElement } from '@mavisdraw/types';
import { onHistoryApplied, useElementsStore } from '../stores/elementsStore';
import { useModelStore } from '../stores/modelStore';
import { shapesWhoseLabelChanged } from '../services/modelSync';
import { apiUpdateComponent } from '../services/api';

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  apiUpdateComponent: vi.fn(async () => ({ component: {} })),
  apiGetModel: vi.fn(async () => ({ model: { components: [], relationships: [] } })),
}));

const store = () => useElementsStore.getState();

/** A labelled box showing component c-api (also drawn on another diagram). */
function apiBox(): { shape: MavisElement; label: TextElement } {
  const shape = store().createElement('rectangle', 'd1', 0, 0, 120, 60);
  shape.componentId = 'c-api';
  store().addElement(shape);
  const label = store().createBoundText(shape.id, 'API') as TextElement;
  return { shape, label };
}

const model = (shapeId: string): ProjectModel => ({
  components: [
    {
      id: 'c-api',
      name: 'API',
      kind: 'service',
      description: null,
      technology: null,
      owner: null,
      tags: [],
      links: [],
      code: null,
      detailDiagramId: null,
      appearances: [
        { diagramId: 'd1', elementId: shapeId, path: ['Shop'] },
        { diagramId: 'd2', elementId: 'elsewhere', path: ['Shop', 'Platform'] },
      ],
      parents: [],
      stored: false,
    },
  ],
  relationships: [],
});

beforeEach(() => {
  useElementsStore.setState({ elements: new Map(), history: [], historyIndex: -1 });
  vi.mocked(apiUpdateComponent).mockClear();
});

describe('undo and redo of a component label', () => {
  it('tell listeners which elements they changed', () => {
    const { label } = apiBox();
    store().updateElement(label.id, { text: 'Core API' } as Partial<MavisElement>);
    const seen: string[][] = [];
    const stop = onHistoryApplied((ids) => seen.push(ids));
    store().undo();
    store().redo();
    stop();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain(label.id);
    expect(seen[1]).toContain(label.id);
  });

  it('are traced back to the shape whose label changed', () => {
    const { shape, label } = apiBox();
    expect(shapesWhoseLabelChanged([label.id, 'gone'], store().elements)).toEqual([shape.id]);
  });

  it('rename the component everywhere, like typing the label would', () => {
    const { shape, label } = apiBox();
    useModelStore.setState({ projectId: 'p1', model: model(shape.id), fetchedAt: 1 });
    store().updateElement(label.id, { text: 'Core API' } as Partial<MavisElement>);

    store().undo(); // back to "API" here, and everywhere else
    expect(apiUpdateComponent).toHaveBeenLastCalledWith('p1', 'c-api', { name: 'API' });
    store().redo(); // and forward again
    expect(apiUpdateComponent).toHaveBeenLastCalledWith('p1', 'c-api', { name: 'Core API' });
  });
});

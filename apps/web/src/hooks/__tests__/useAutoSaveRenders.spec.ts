import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  apiUpdateDiagram: vi.fn().mockResolvedValue({ diagram: {} }),
  apiSaveDiagram: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../services/diagramSync', () => ({
  ensureDiagramOnServer: vi.fn().mockResolvedValue(undefined),
}));

import { useAutoSave } from '../useAutoSave';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { useAuthStore } from '../../stores/authStore';
import { elementCountsKey } from '../../components/navigation/DiagramTreeSidebar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useAutoSave does not re-render the editor on element changes', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.setState({ isAuthenticated: true });
    useElementsStore.setState({ elements: new Map(), history: [], historyIndex: -1 });
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    useAuthStore.setState({ isAuthenticated: false });
  });

  it('schedules a save from a store subscription, without rendering', () => {
    let renders = 0;
    function Probe() {
      renders++;
      useAutoSave('diagram-1');
      return null;
    }
    act(() => root.render(createElement(Probe)));
    const rendersAfterMount = renders;
    vi.clearAllTimers();

    // Twenty pointer moves' worth of element changes
    for (let i = 0; i < 20; i++) {
      act(() => {
        const el = useElementsStore.getState().createElement('rectangle', 'diagram-1', i, 0, 10, 10);
        useElementsStore.setState({ elements: new Map([[el.id, el]]) });
      });
    }
    expect(renders).toBe(rendersAfterMount);
    // …and the debounced save is armed
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // Diagram metadata changes arm it too
    vi.clearAllTimers();
    act(() => useDiagramStore.setState({ diagrams: new Map(useDiagramStore.getState().diagrams) }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });
});

describe('diagram tree element counts', () => {
  it('only change when elements are added or removed, not moved', () => {
    const store = useElementsStore.getState();
    const a = store.createElement('rectangle', 'd1', 0, 0, 10, 10);
    const b = store.createElement('rectangle', 'd2', 0, 0, 10, 10);
    const key = elementCountsKey(new Map([[a.id, a], [b.id, b]]));
    expect(key).toBe('d1:1|d2:1');
    const moved = { ...a, x: 500 };
    expect(elementCountsKey(new Map([[a.id, moved], [b.id, b]]))).toBe(key);
    const deleted = { ...b, isDeleted: true };
    expect(elementCountsKey(new Map([[a.id, a], [b.id, deleted]]))).toBe('d1:1');
  });
});

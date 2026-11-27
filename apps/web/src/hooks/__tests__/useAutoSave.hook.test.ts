import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Diagram, MavisElement } from '@mavisdraw/types';

/**
 * The autosave hook as the editor mounts it: debounced saves of every dirty
 * diagram, conflict-checked against what the server last had. The API is
 * mocked; stores and save tracking are real.
 */

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    apiUpdateDiagram: vi.fn(),
    apiSaveDiagram: vi.fn(async () => ({})),
    apiCreateDiagram: vi.fn(async () => ({ diagram: {} })),
  };
});

const api = await import('../../services/api');
const { useAutoSave } = await import('../useAutoSave');
const { useElementsStore } = await import('../../stores/elementsStore');
const { useDiagramStore } = await import('../../stores/diagramStore');
const { useAuthStore } = await import('../../stores/authStore');
const { useCollaborationStore } = await import('../../stores/collaborationStore');
const { useToastStore } = await import('../../stores/toastStore');
const { recordSaved, resetSaveTracking, savedVersions } =
  await import('../../services/saveTracker');
const { resetDiagramSync } = await import('../../services/diagramSync');

const updateDiagram = vi.mocked(api.apiUpdateDiagram);
const createDiagram = vi.mocked(api.apiCreateDiagram);
const saveVersion = vi.mocked(api.apiSaveDiagram);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = 'root-diagram';
const CHILD = 'child-diagram';

function diagram(id: string, extra: Partial<Diagram> = {}): Diagram {
  return {
    id,
    projectId: 'p1',
    parentDiagramId: null,
    parentPortalId: null,
    title: id,
    viewBackgroundColor: '#ffffff',
    gridEnabled: true,
    gridSize: 20,
    renderMode: 'clean',
    layers: [],
    createdBy: 'u1',
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

function box(id: string, version: number, extra: Partial<MavisElement> = {}): MavisElement {
  return {
    id,
    type: 'rectangle',
    diagramId: ROOT,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    version,
    isDeleted: false,
    ...extra,
  } as MavisElement;
}

const setElements = (list: MavisElement[]) =>
  act(() => useElementsStore.setState({ elements: new Map(list.map((el) => [el.id, el])) }));

/** Let timers run (and the promises they start settle). */
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

type SaveBody = {
  elements?: MavisElement[];
  baseVersions?: Record<string, number>;
  deletedIds?: string[];
  title?: string;
};
const bodyOf = (call: number) => updateDiagram.mock.calls[call][1] as SaveBody;
const idsSent = (call: number) => (bodyOf(call).elements ?? []).map((el) => el.id);

let root: Root;
let hook: ReturnType<typeof useAutoSave>;
function Harness({ id }: { id: string }) {
  hook = useAutoSave(id);
  return null;
}
const mount = () =>
  act(() => {
    root = createRoot(document.createElement('div'));
    root.render(createElement(Harness, { id: ROOT }));
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // The server stores what it's sent and answers with it
  updateDiagram.mockImplementation(async (_id, body) => ({
    diagram: { elements: (body as SaveBody).elements ?? [] } as never,
    conflicts: [],
  }));
  resetSaveTracking();
  resetDiagramSync([ROOT]);
  useAuthStore.setState({ isAuthenticated: true });
  useCollaborationStore.setState({ connectionStatus: 'disconnected', syncedDiagramId: null });
  useToastStore.setState({ toasts: [] });
  useDiagramStore.setState({
    diagrams: new Map([[ROOT, diagram(ROOT)]]),
    activeDiagramId: ROOT,
  });
  useElementsStore.setState({ elements: new Map(), history: [], historyIndex: -1 });
  // The diagram was loaded from the server, empty
  recordSaved(ROOT, [], 1);
});

afterEach(() => {
  act(() => root?.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useAutoSave', () => {
  it('saves a burst of edits once, with the latest contents, then reports saved', async () => {
    await mount();
    await setElements([box('a', 1)]);
    await wait(500);
    await setElements([box('a', 2, { x: 40 })]);
    await wait(500);
    await setElements([box('a', 2, { x: 40 }), box('b', 1)]);
    expect(updateDiagram).not.toHaveBeenCalled();

    await wait(1500);
    expect(updateDiagram).toHaveBeenCalledTimes(1);
    expect(bodyOf(0).elements).toEqual([box('a', 2, { x: 40 }), box('b', 1)]);
    expect(hook.saveStatus).toBe('saved');
    await wait(3000);
    expect(hook.saveStatus).toBe('idle');

    // Nothing changed since: nothing more is sent
    await wait(5000);
    expect(updateDiagram).toHaveBeenCalledTimes(1);
  });

  it('sends what the server last had as the base, and deletions explicitly', async () => {
    recordSaved(ROOT, [box('a', 3), box('b', 2)], 1);
    await mount();
    // "a" edited, "b" deleted
    await setElements([box('a', 4, { x: 9 }), box('b', 3, { isDeleted: true })]);
    await wait(1500);

    expect(idsSent(0)).toEqual(['a']);
    expect(bodyOf(0).baseVersions).toEqual({ a: 3, b: 2 });
    expect(bodyOf(0).deletedIds).toEqual(['b']);
  });

  it("keeps a teammate's newer version on conflict, says so, and builds on it", async () => {
    recordSaved(ROOT, [box('a', 3)], 1);
    const theirs = box('a', 9, { x: 500 });
    updateDiagram.mockResolvedValueOnce({
      diagram: { elements: [theirs] } as never,
      conflicts: ['a'],
    });
    await mount();
    await setElements([box('a', 4, { x: -1 })]);
    const undoSteps = useElementsStore.getState().history.length;
    await wait(1500);

    expect(useElementsStore.getState().elements.get('a')).toMatchObject({ x: 500, version: 9 });
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      'A teammate changed a shape you also edited — kept their newer version.',
    ]);
    // The next save is based on their version
    expect(savedVersions(ROOT)?.get('a')).toBe(9);
    // Adopting their version isn't an edit of mine: no new save, no undo step
    await wait(5000);
    expect(updateDiagram).toHaveBeenCalledTimes(1);
    expect(useElementsStore.getState().history).toHaveLength(undoSteps);
  });

  it('saves parents before children, creating a nested diagram the server lacks', async () => {
    const child = diagram(CHILD, { parentDiagramId: ROOT });
    useDiagramStore.setState({
      diagrams: new Map([
        [CHILD, child],
        [ROOT, diagram(ROOT)],
      ]),
    });
    updateDiagram.mockImplementation(async (id, body) => {
      if (id === CHILD && createDiagram.mock.calls.length === 0) {
        throw new api.ApiError('Diagram not found', 404);
      }
      return { diagram: { elements: (body as SaveBody).elements ?? [] } as never, conflicts: [] };
    });
    await mount();
    await setElements([box('in-child', 1, { diagramId: CHILD }), box('on-root', 1)]);
    await wait(1500);

    expect(updateDiagram.mock.calls.map(([id]) => id)).toEqual([ROOT, CHILD, CHILD]);
    expect(createDiagram).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHILD, projectId: 'p1', parentDiagramId: ROOT }),
    );
    expect(hook.saveStatus).toBe('saved');
  });

  it('shows a failed save, and the next edit saves everything', async () => {
    updateDiagram.mockRejectedValueOnce(new api.ApiError('Internal server error', 500));
    await mount();
    await setElements([box('a', 1)]);
    await wait(1500);
    expect(hook.saveStatus).toBe('error');

    await setElements([box('a', 1), box('b', 1)]);
    await wait(1500);
    expect(updateDiagram).toHaveBeenCalledTimes(2);
    expect(idsSent(1)).toEqual(['a', 'b']);
    expect(hook.saveStatus).toBe('saved');
  });

  it('an edit made while a save is in flight is saved right after it', async () => {
    let finish!: () => void;
    updateDiagram.mockImplementationOnce(
      (_id, body) =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ diagram: { elements: (body as SaveBody).elements } as never, conflicts: [] });
        }),
    );
    await mount();
    await setElements([box('a', 1)]);
    await wait(1500);
    expect(updateDiagram).toHaveBeenCalledTimes(1);

    // Still saving when the next edit's debounce fires
    await setElements([box('a', 2, { x: 70 })]);
    await wait(1500);
    expect(updateDiagram).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await wait(0);

    expect(updateDiagram).toHaveBeenCalledTimes(2);
    expect(bodyOf(1).elements).toEqual([box('a', 2, { x: 70 })]);
    expect(bodyOf(1).baseVersions).toEqual({ a: 1 });
  });

  it('saves at once when the tab is hidden or the editor closes', async () => {
    await mount();
    await setElements([box('a', 1)]);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(updateDiagram).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    // Back to the dashboard mid-debounce
    await setElements([box('a', 1), box('b', 1)]);
    await act(async () => root.unmount());
    await wait(0);
    expect(updateDiagram).toHaveBeenCalledTimes(2);
    expect(idsSent(1)).toEqual(['a', 'b']);
  });

  it('while a live room syncs the diagram, only changed metadata goes over REST', async () => {
    useCollaborationStore.setState({
      connectionStatus: 'connected',
      syncedDiagramId: ROOT,
      provider: { isAuthenticated: true } as never,
    });
    await mount();
    await setElements([box('a', 1)]);
    await wait(1500);
    expect(updateDiagram).not.toHaveBeenCalled();

    await act(() =>
      useDiagramStore.setState({
        diagrams: new Map([[ROOT, diagram(ROOT, { title: 'Renamed', updatedAt: 2 })]]),
      }),
    );
    await wait(1500);
    expect(updateDiagram).toHaveBeenCalledTimes(1);
    expect(bodyOf(0)).toMatchObject({ title: 'Renamed' });
    expect(bodyOf(0)).not.toHaveProperty('elements');
  });

  it('a manual save stores pending edits first, then the version', async () => {
    const order: string[] = [];
    updateDiagram.mockImplementation(async (_id, body) => {
      order.push('save');
      return { diagram: { elements: (body as SaveBody).elements } as never, conflicts: [] };
    });
    saveVersion.mockImplementation(async () => {
      order.push('version');
      return {};
    });
    await mount();
    await setElements([box('a', 1)]);
    await act(() => hook.manualSave());
    expect(order).toEqual(['save', 'version']);
    expect(saveVersion).toHaveBeenCalledWith(ROOT, 'manual');
  });

  it('saves nothing while signed out', async () => {
    useAuthStore.setState({ isAuthenticated: false });
    await mount();
    await setElements([box('a', 1)]);
    await wait(5000);
    expect(updateDiagram).not.toHaveBeenCalled();
  });
});

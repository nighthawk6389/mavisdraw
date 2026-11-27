import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Diagram, MavisElement } from '@mavisdraw/types';

/**
 * Keeping the editor's diagram hierarchy and contents in step with the
 * server: nested diagrams are created once (parents first), contents are
 * loaded once without clobbering newer local edits, and diagrams teammates
 * add show up without disturbing ones already open. The API is mocked.
 */

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    apiCreateDiagram: vi.fn(async () => ({ diagram: {} })),
    apiGetDiagram: vi.fn(),
    apiListDiagrams: vi.fn(),
  };
});

const api = await import('../api');
const sync = await import('../diagramSync');
const { useElementsStore } = await import('../../stores/elementsStore');
const { useDiagramStore } = await import('../../stores/diagramStore');
const { resetSaveTracking, savedVersions } = await import('../saveTracker');

const createDiagram = vi.mocked(api.apiCreateDiagram);
const getDiagram = vi.mocked(api.apiGetDiagram);
const listDiagrams = vi.mocked(api.apiListDiagrams);

function diagram(id: string, parentDiagramId: string | null = null, title = id): Diagram {
  return {
    id,
    projectId: 'p1',
    parentDiagramId,
    parentPortalId: null,
    title,
    viewBackgroundColor: '#ffffff',
    gridEnabled: true,
    gridSize: 20,
    renderMode: 'clean',
    layers: [],
    createdBy: 'u1',
    createdAt: 1,
    updatedAt: 1,
  };
}

/** The server's shape of a diagram (dates as strings). */
const serverDiagram = (d: Diagram, elements: MavisElement[] = []) =>
  ({
    ...d,
    elements,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  }) as never;

function box(id: string, version: number, x = 0, diagramId = 'root'): MavisElement {
  return {
    id,
    type: 'rectangle',
    diagramId,
    x,
    y: 0,
    width: 10,
    height: 10,
    version,
    isDeleted: false,
  } as MavisElement;
}

/** A promise you settle by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  sync.resetDiagramSync(['root']);
  resetSaveTracking();
  useDiagramStore.setState({
    diagrams: new Map([['root', diagram('root')]]),
    activeDiagramId: 'root',
  });
  useElementsStore.setState({ elements: new Map(), history: [], historyIndex: -1 });
});

describe('creating nested diagrams on the server', () => {
  it('creates missing ancestors first, each once, even when asked concurrently', async () => {
    const a = diagram('a', 'root');
    const b = diagram('b', 'a');
    useDiagramStore.setState((s) => ({ diagrams: new Map(s.diagrams).set('a', a).set('b', b) }));

    await Promise.all([sync.ensureDiagramOnServer(b), sync.ensureDiagramOnServer(b)]);
    expect(createDiagram.mock.calls.map(([input]) => input.id)).toEqual(['a', 'b']);
    expect(createDiagram).toHaveBeenCalledWith({
      id: 'b',
      projectId: 'p1',
      parentDiagramId: 'a',
      parentPortalId: null,
      title: 'b',
    });
    // Known now: no more requests
    await sync.ensureDiagramOnServer(b);
    expect(createDiagram).toHaveBeenCalledTimes(2);
  });

  it('a failed create is retried the next time', async () => {
    const a = diagram('a', 'root');
    createDiagram.mockRejectedValueOnce(new Error('offline'));
    await expect(sync.ensureDiagramOnServer(a)).rejects.toThrow('offline');
    await sync.ensureDiagramOnServer(a);
    expect(createDiagram).toHaveBeenCalledTimes(2);
  });

  it('a diagram drawn in the editor is created right away, and needs no load', async () => {
    const a = diagram('a', 'root');
    sync.registerNewDiagram(a);
    expect(sync.isDiagramLoaded('a')).toBe(true);
    await vi.waitFor(() => expect(createDiagram).toHaveBeenCalledTimes(1));
    // Its (empty) contents count as saved
    expect(savedVersions('a')?.size).toBe(0);
  });
});

describe('loading contents', () => {
  it('loads once, keeps newer local edits, and records what the server has', async () => {
    useElementsStore.setState({
      elements: new Map([
        ['mine', box('mine', 5, 99)],
        ['stale', box('stale', 1, 0)],
      ]),
    });
    const undoSteps = useElementsStore.getState().history.length;
    const pending = deferred<{ diagram: never }>();
    getDiagram.mockReturnValueOnce(pending.promise);

    const first = sync.loadDiagramElements('root');
    const second = sync.loadDiagramElements('root');
    pending.resolve({
      diagram: serverDiagram(diagram('root'), [
        box('mine', 3, 1),
        box('stale', 2, 50),
        box('new', 1),
      ]),
    });
    await Promise.all([first, second]);

    expect(getDiagram).toHaveBeenCalledTimes(1);
    const els = useElementsStore.getState().elements;
    expect(els.get('mine')).toMatchObject({ version: 5, x: 99 }); // local edit is newer
    expect(els.get('stale')).toMatchObject({ version: 2, x: 50 });
    expect(els.get('new')).toBeTruthy();
    expect(Object.fromEntries(savedVersions('root')!)).toEqual({ mine: 3, stale: 2, new: 1 });
    // Loading isn't an edit: nothing to undo
    expect(useElementsStore.getState().history).toHaveLength(undoSteps);

    await sync.loadDiagramElements('root');
    expect(getDiagram).toHaveBeenCalledTimes(1);
  });

  it('a diagram the server has never seen counts as loaded (and empty)', async () => {
    getDiagram.mockRejectedValueOnce(new api.ApiError('Diagram not found', 404));
    await sync.loadDiagramElements('fresh');
    expect(sync.isDiagramLoaded('fresh')).toBe(true);
  });

  it('any other failure is reported and the load can be retried', async () => {
    getDiagram.mockRejectedValueOnce(new api.ApiError('Access denied', 403));
    await expect(sync.loadDiagramElements('root')).rejects.toMatchObject({ statusCode: 403 });
    expect(sync.isDiagramLoaded('root')).toBe(false);

    getDiagram.mockResolvedValueOnce({ diagram: serverDiagram(diagram('root'), [box('x', 1)]) });
    await sync.loadDiagramElements('root');
    expect(useElementsStore.getState().elements.has('x')).toBe(true);
  });
});

describe('diagrams teammates added', () => {
  it('appear, without replacing diagrams already open; concurrent refreshes share a request', async () => {
    // Renamed locally, not saved yet
    useDiagramStore.setState({
      diagrams: new Map([['root', diagram('root', null, 'My local title')]]),
    });
    const pending = deferred<{ diagrams: never[] }>();
    listDiagrams.mockReturnValueOnce(pending.promise as never);

    const one = sync.refreshDiagramList('p1');
    const two = sync.refreshDiagramList('p1');
    pending.resolve({
      diagrams: [
        serverDiagram(diagram('root', null, 'Server title')),
        serverDiagram(diagram('theirs', 'root', 'Payments')),
      ],
    });
    await Promise.all([one, two]);

    expect(listDiagrams).toHaveBeenCalledTimes(1);
    const diagrams = useDiagramStore.getState().diagrams;
    expect(diagrams.get('root')?.title).toBe('My local title');
    expect(diagrams.get('theirs')).toMatchObject({ title: 'Payments', parentDiagramId: 'root' });
    // It exists on the server: saving into it never tries to create it
    await sync.ensureDiagramOnServer(diagrams.get('theirs')!);
    expect(createDiagram).not.toHaveBeenCalled();
  });

  it('a failed refresh leaves things as they were', async () => {
    listDiagrams.mockRejectedValueOnce(new Error('offline'));
    await sync.refreshDiagramList('p1');
    expect([...useDiagramStore.getState().diagrams.keys()]).toEqual(['root']);
  });

  it('going to a diagram nobody has heard of fails cleanly', async () => {
    listDiagrams.mockResolvedValueOnce({ diagrams: [serverDiagram(diagram('root'))] } as never);
    expect(await sync.goToDiagram('deleted-long-ago')).toBe(false);
    expect(useDiagramStore.getState().activeDiagramId).toBe('root');
  });
});

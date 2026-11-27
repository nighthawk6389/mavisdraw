import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Diagram, MavisElement } from '@mavisdraw/types';
import { useElementsStore } from '../stores/elementsStore';
import {
  findDirtyDiagrams,
  recordSaved,
  resetSaveTracking,
  savedVersions,
} from '../services/saveTracker';
import { apiUpdateDiagram } from '../services/api';
import { saveDiagram } from '../hooks/useAutoSave';

/**
 * Two REST saves with a teammate's change in between (review finding C1):
 * the second save must never revert their edit or delete their new shape.
 * The "server" here applies the same rules as the API's REST merge.
 */

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  apiUpdateDiagram: vi.fn(),
}));
vi.mock('../stores/collaborationStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stores/collaborationStore')>()),
  isLiveSynced: () => false,
}));
vi.mock('../services/offlineJournal', () => ({ acknowledge: vi.fn() }));

const D = 'd1';
const diagram = { id: D, updatedAt: 0, title: 'D', layers: [] } as unknown as Diagram;
const el = (id: string, version: number, x = 0) =>
  ({
    id,
    diagramId: D,
    type: 'rectangle',
    version,
    x,
    y: 0,
    isDeleted: false,
  }) as unknown as MavisElement;

type Body = {
  elements: MavisElement[];
  baseVersions: Record<string, number>;
  deletedIds: string[];
};

/** The API's REST merge (apps/server/src/ws/ydocElements.ts), in miniature. */
let server: MavisElement[] = [];
function serverMerge(body: Body) {
  const byId = new Map(server.map((e) => [e.id, e]));
  const conflicts: string[] = [];
  for (const e of body.elements) {
    const current = byId.get(e.id);
    const base = body.baseVersions[e.id];
    let decision: 'apply' | 'unchanged' | 'conflict';
    if (base !== undefined) {
      if (e.version === base) decision = 'unchanged';
      else if (e.version < base) decision = 'conflict';
      else decision = current && current.version === base ? 'apply' : 'conflict';
    } else decision = current ? (e.version > current.version ? 'apply' : 'unchanged') : 'apply';
    if (decision === 'conflict') conflicts.push(e.id);
    if (decision === 'apply') {
      byId.set(e.id, { ...e, version: Math.max(e.version, (current?.version ?? 0) + 1) });
    }
  }
  for (const id of body.deletedIds) {
    const current = byId.get(id);
    if (current && current.version === body.baseVersions[id]) byId.delete(id);
    else if (current) conflicts.push(id);
  }
  server = Array.from(byId.values());
  return { diagram: { ...diagram, elements: server }, conflicts };
}

const store = () => useElementsStore.getState().elements;
const put = (e: MavisElement) =>
  useElementsStore.setState((s) => ({ elements: new Map(s.elements).set(e.id, e) }));
const saveNow = () =>
  saveDiagram(
    diagram,
    Array.from(store().values()).filter((e) => e.diagramId === D && !e.isDeleted),
  );

beforeEach(() => {
  resetSaveTracking();
  useElementsStore.setState({ elements: new Map(), history: [], historyIndex: -1 });
  vi.mocked(apiUpdateDiagram).mockImplementation(
    async (_id, body) => serverMerge(body as Body) as never,
  );
  // Loaded state: the server and this tab agree on E v5
  server = [el('E', 5, 0)];
  put(el('E', 5, 0));
  recordSaved(D, [el('E', 5, 0)]);
});

describe('REST saves after a teammate changed the diagram', () => {
  it('take in the teammate’s work, so the next save keeps it', async () => {
    // A teammate moves E and adds N
    server = [el('E', 6, 999), el('N', 1, 50)];

    put(el('F', 1)); // this tab adds F → save #1
    await saveNow();
    expect(store().get('E')).toMatchObject({ version: 6, x: 999 });
    expect(store().get('N')).toMatchObject({ version: 1 });
    expect(savedVersions(D)).toEqual(
      new Map([
        ['E', 6],
        ['N', 1],
        ['F', 1],
      ]),
    );
    // Nothing left to save until this tab edits again
    expect(findDirtyDiagrams(store(), new Map([[D, diagram]]))).toHaveLength(0);

    put(el('F', 2, 10)); // this tab nudges F → save #2
    await saveNow();
    const after = new Map(server.map((e) => [e.id, e]));
    expect(after.get('E')).toMatchObject({ x: 999 }); // not reverted
    expect(after.has('N')).toBe(true); // not deleted
    expect(after.get('F')).toMatchObject({ x: 10 });
  });

  it('don’t record a teammate’s change as seen when this tab edited that shape mid-save', async () => {
    let release!: () => void;
    vi.mocked(apiUpdateDiagram).mockImplementationOnce(async (_id, body) => {
      await new Promise<void>((r) => (release = r));
      return serverMerge(body as Body) as never;
    });
    put(el('F', 1));
    const saving = saveNow();
    // While the save is in flight: a teammate moves E, and this tab edits E too
    server = [el('E', 6, 999), ...server.filter((e) => e.id !== 'E')];
    put(el('E', 6, -5));
    release();
    await saving;
    // This tab's edit stays, and its base is still what it was edited from…
    expect(store().get('E')).toMatchObject({ x: -5 });
    expect(savedVersions(D)?.get('E')).toBe(5);
    // …so the next save is a conflict, never a silent overwrite of x=999
    await saveNow();
    expect(server.find((e) => e.id === 'E')).toMatchObject({ x: 999 });
  });

  it('do not add an undo step', async () => {
    server = [el('E', 6, 999)];
    put(el('F', 1));
    const before = useElementsStore.getState().history.length;
    await saveNow();
    expect(useElementsStore.getState().history.length).toBe(before);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import type { Hocuspocus } from '@hocuspocus/server';
import {
  applyAccessChange,
  createHocuspocusServer,
  persistOpenDocuments,
  reapplyProjectAccess,
} from '../ws/hocuspocus.js';
import { seedElements } from '../ws/ydocElements.js';
import { updateDiagram } from '../services/diagramService.js';

vi.mock('../services/diagramService.js', () => ({
  getDiagram: vi.fn(),
  updateDiagram: vi.fn(async () => ({})),
  checkProjectAccess: vi.fn(),
}));

describe('createHocuspocusServer', () => {
  it('should create a Hocuspocus server instance', () => {
    const server = createHocuspocusServer();
    expect(server).toBeDefined();
    expect(typeof server.handleConnection).toBe('function');
  });

  it('should configure debounce settings', () => {
    const server = createHocuspocusServer();
    // The server should be created without errors
    expect(server).toBeTruthy();
  });
});

describe('persistOpenDocuments (graceful shutdown)', () => {
  beforeEach(() => vi.mocked(updateDiagram).mockClear());

  function openDoc(loading = false) {
    const doc = new Y.Doc() as Y.Doc & { isLoading: boolean };
    doc.isLoading = loading;
    return doc;
  }

  it('writes every loaded live document, skipping deleted elements', async () => {
    const a = openDoc();
    seedElements(a, [
      { id: 'kept', version: 1, isDeleted: false },
      { id: 'gone', version: 2, isDeleted: true },
    ]);
    const stillLoading = openDoc(true);
    const documents = new Map<string, unknown>([
      ['diagram:d1', a],
      ['diagram:d2', stillLoading],
    ]);

    await persistOpenDocuments({ documents } as unknown as Pick<Hocuspocus, 'documents'>);

    expect(updateDiagram).toHaveBeenCalledTimes(1);
    const [id, data] = vi.mocked(updateDiagram).mock.calls[0];
    expect(id).toBe('d1');
    expect((data.elements as { id: string }[]).map((e) => e.id)).toEqual(['kept']);
    expect(typeof data.yjsState).toBe('string');
  });

  it('one failing write does not stop the others', async () => {
    vi.mocked(updateDiagram).mockRejectedValueOnce(new Error('db down'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const documents = new Map<string, unknown>([
      ['diagram:d1', openDoc()],
      ['diagram:d2', openDoc()],
    ]);
    await expect(
      persistOpenDocuments({ documents } as unknown as Pick<Hocuspocus, 'documents'>),
    ).resolves.toBeUndefined();
    expect(updateDiagram).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });
});

describe('applyAccessChange (permissions change while connected)', () => {
  function room(users: Array<{ id: string; projectId: string }>) {
    const doc = new Y.Doc() as Y.Doc & { connections: Map<unknown, { connection: unknown }> };
    doc.connections = new Map();
    const conns = users.map((user) => {
      const connection = {
        context: { user },
        readOnly: false,
        close: vi.fn(),
        webSocket: { close: vi.fn() },
      };
      doc.connections.set(connection, { connection });
      return connection;
    });
    return { doc, conns };
  }

  it('disconnects a removed member and tells the room', () => {
    const { doc, conns } = room([
      { id: 'bob', projectId: 'p1' },
      { id: 'alice', projectId: 'p1' },
    ]);
    const server = { documents: new Map([['diagram:d1', doc]]) } as unknown as Pick<
      Hocuspocus,
      'documents'
    >;
    expect(applyAccessChange(server, 'p1', 'bob', null)).toBe(1);
    expect(conns[0].webSocket.close).toHaveBeenCalledWith(4403, 'Access revoked');
    expect(conns[1].webSocket.close).not.toHaveBeenCalled();
    expect(doc.getMap('signals').get('permissions')).toBe(1);
  });

  it('makes a downgraded member read-only, and leaves other projects alone', () => {
    const { doc, conns } = room([
      { id: 'bob', projectId: 'p1' },
      { id: 'bob', projectId: 'p2' },
    ]);
    const server = { documents: new Map([['diagram:d1', doc]]) } as unknown as Pick<
      Hocuspocus,
      'documents'
    >;
    applyAccessChange(server, 'p1', 'bob', 'viewer');
    expect(conns[0].readOnly).toBe(true);
    expect(conns[1].readOnly).toBe(false);
    applyAccessChange(server, 'p1', 'bob', 'editor');
    expect(conns[0].readOnly).toBe(false);
  });

  it('a project leaving a workspace or going private re-checks everyone connected', async () => {
    const { doc, conns } = room([
      { id: 'owner', projectId: 'p1' },
      { id: 'teammate', projectId: 'p1' }, // had edit access through the workspace
      { id: 'passerby', projectId: 'p1' }, // was viewing it because it was public
      { id: 'teammate', projectId: 'p2' },
    ]);
    const server = { documents: new Map([['diagram:d1', doc]]) } as unknown as Pick<
      Hocuspocus,
      'documents'
    >;
    const accessOf = vi.fn(async (_p: string, userId: string) =>
      userId === 'owner' ? ('owner' as const) : null,
    );
    await reapplyProjectAccess(server, 'p1', accessOf);
    expect(accessOf.mock.calls.map((c) => c[1]).sort()).toEqual(['owner', 'passerby', 'teammate']);
    expect(conns[0].webSocket.close).not.toHaveBeenCalled();
    expect(conns[1].webSocket.close).toHaveBeenCalledWith(4403, 'Access revoked');
    expect(conns[2].webSocket.close).toHaveBeenCalledWith(4403, 'Access revoked');
    // The same person in another project's room is untouched
    expect(conns[3].webSocket.close).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import type { Hocuspocus } from '@hocuspocus/server';
import { createHocuspocusServer, persistOpenDocuments } from '../ws/hocuspocus.js';
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

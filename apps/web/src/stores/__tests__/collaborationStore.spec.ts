import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock HocuspocusProvider before imports
const sockets = vi.hoisted(() => [] as Array<{ url: string; destroy: () => void }>);

vi.mock('@hocuspocus/provider', () => {
  return {
    HocuspocusProviderWebsocket: vi.fn().mockImplementation((opts: { url: string }) => {
      const socket = { url: opts.url, destroy: vi.fn() };
      sockets.push(socket);
      return socket;
    }),
    HocuspocusProvider: vi.fn().mockImplementation((opts) => {
      const instance = {
        url: opts.url,
        name: opts.name,
        document: opts.document,
        destroy: vi.fn(),
        setAwarenessField: vi.fn(),
        connect: vi.fn(),
        on: vi.fn(),
        isAuthenticated: true,
        _opts: opts,
        // Simulate connect
        triggerConnect() {
          opts.onConnect?.();
        },
        triggerDisconnect() {
          opts.onDisconnect?.();
        },
        triggerSync() {
          opts.onSynced?.();
        },
        triggerAuthFailed() {
          instance.isAuthenticated = false;
          opts.onAuthenticationFailed?.({ reason: 'permission-denied' });
        },
        triggerAwarenessUpdate(states: Record<string, unknown>[]) {
          opts.onAwarenessUpdate?.({ states });
        },
      };
      // Auto-connect after construction
      setTimeout(() => instance.triggerConnect(), 0);
      return instance;
    }),
  };
});

// Mock getAccessToken
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  getAccessToken: vi.fn(() => 'mock-token'),
  getFreshAccessToken: vi.fn(async () => 'mock-token'),
  forceRefreshAccessToken: vi.fn(async () => true),
  apiGetProject: vi.fn(async () => ({ project: { role: 'editor' } })),
}));

import { useCollaborationStore, isLiveSynced, colorFor } from '../collaborationStore';
import { useElementsStore } from '../elementsStore';

describe('collaborationStore', () => {
  beforeEach(() => {
    // Reset stores
    useCollaborationStore.setState({
      connectionStatus: 'disconnected',
      provider: null,
      doc: null,
      currentDiagramId: null,
      connectedUsers: [],
      remoteCursors: new Map(),
      followingUserId: null,
      localUserId: null,
      _elementsUnsubscribe: null,
      syncedDiagramId: null,
    });
    useElementsStore.setState({
      elements: new Map(),
      history: [],
      historyIndex: -1,
      clipboard: null,
    });
  });

  afterEach(() => {
    const state = useCollaborationStore.getState();
    if (state.provider) {
      state.disconnect();
    }
  });

  it('should start disconnected', () => {
    const state = useCollaborationStore.getState();
    expect(state.connectionStatus).toBe('disconnected');
    expect(state.provider).toBeNull();
    expect(state.doc).toBeNull();
    expect(state.currentDiagramId).toBeNull();
    expect(state.connectedUsers).toEqual([]);
    expect(state.remoteCursors.size).toBe(0);
  });

  it('should connect to a diagram room', () => {
    const store = useCollaborationStore.getState();
    store.connect('diagram-1', 'user-1', 'Alice');

    const state = useCollaborationStore.getState();
    expect(state.connectionStatus).toBe('connecting');
    expect(state.provider).not.toBeNull();
    expect(state.doc).not.toBeNull();
    expect(state.currentDiagramId).toBe('diagram-1');
    expect(state.localUserId).toBe('user-1');
  });

  it('should create provider with correct room name', () => {
    const store = useCollaborationStore.getState();
    store.connect('diagram-1', 'user-1', 'Alice');

    const provider = useCollaborationStore.getState().provider as any;
    expect(provider).not.toBeNull();
    expect(provider.name).toBe('diagram:diagram-1');
  });

  it('should set awareness fields on connect', () => {
    const store = useCollaborationStore.getState();
    store.connect('diagram-1', 'user-1', 'Alice');

    const provider = useCollaborationStore.getState().provider as any;
    expect(provider.setAwarenessField).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({
        id: 'user-1',
        name: 'Alice',
      }),
    );
    expect(provider.setAwarenessField).toHaveBeenCalledWith('diagramId', 'diagram-1');
  });

  it('should disconnect and reset state', () => {
    const store = useCollaborationStore.getState();
    store.connect('diagram-1', 'user-1', 'Alice');
    store.disconnect();

    const state = useCollaborationStore.getState();
    expect(state.connectionStatus).toBe('disconnected');
    expect(state.provider).toBeNull();
    expect(state.doc).toBeNull();
    expect(state.currentDiagramId).toBeNull();
    expect(state.connectedUsers).toEqual([]);
    expect(state.remoteCursors.size).toBe(0);
  });

  it('should disconnect existing connection when connecting to new room', () => {
    const store = useCollaborationStore.getState();
    store.connect('diagram-1', 'user-1', 'Alice');
    const firstProvider = useCollaborationStore.getState().provider as any;

    store.connect('diagram-2', 'user-1', 'Alice');

    expect(firstProvider.destroy).toHaveBeenCalled();
    const state = useCollaborationStore.getState();
    expect(state.currentDiagramId).toBe('diagram-2');
  });

  it('closes the socket with the connection, even straight after opening it', () => {
    sockets.length = 0;
    const store = useCollaborationStore.getState();
    // The editor mounting twice in a row: connect, disconnect, connect
    store.connect('diagram-1', 'user-1', 'Alice');
    store.disconnect();
    store.connect('diagram-1', 'user-1', 'Alice');
    expect(sockets).toHaveLength(2);
    expect(sockets[0].destroy).toHaveBeenCalled();
    expect(sockets[1].destroy).not.toHaveBeenCalled();
    // Each provider uses its own socket
    const provider = useCollaborationStore.getState().provider as unknown as {
      _opts: { websocketProvider: unknown };
    };
    expect(provider._opts.websocketProvider).toBe(sockets[1]);
    expect(sockets[1].url).toMatch(/^wss?:\/\/.+\/collaboration$/);
    store.disconnect();
    expect(sockets[1].destroy).toHaveBeenCalled();
  });

  it('should update cursor position', () => {
    const store = useCollaborationStore.getState();
    store.connect('diagram-1', 'user-1', 'Alice');
    store.updateCursor(100, 200);

    const provider = useCollaborationStore.getState().provider as any;
    expect(provider.setAwarenessField).toHaveBeenCalledWith('cursor', { x: 100, y: 200 });
  });

  it('should update selection', () => {
    const store = useCollaborationStore.getState();
    store.connect('diagram-1', 'user-1', 'Alice');
    store.updateSelection(['elem-1', 'elem-2']);

    const provider = useCollaborationStore.getState().provider as any;
    expect(provider.setAwarenessField).toHaveBeenCalledWith('selectedElementIds', [
      'elem-1',
      'elem-2',
    ]);
  });

  it('should update viewport', () => {
    const store = useCollaborationStore.getState();
    store.connect('diagram-1', 'user-1', 'Alice');
    store.updateViewport({ scrollX: 10, scrollY: 20, zoom: 1.5 });

    const provider = useCollaborationStore.getState().provider as any;
    expect(provider.setAwarenessField).toHaveBeenCalledWith('viewport', {
      scrollX: 10,
      scrollY: 20,
      zoom: 1.5,
    });
  });

  it('should toggle follow user', () => {
    const store = useCollaborationStore.getState();
    expect(store.followingUserId).toBeNull();

    store.followUser('user-2');
    expect(useCollaborationStore.getState().followingUserId).toBe('user-2');

    store.followUser(null);
    expect(useCollaborationStore.getState().followingUserId).toBeNull();
  });

  it('should not update cursor when not connected', () => {
    const store = useCollaborationStore.getState();
    // Should not throw when no provider
    store.updateCursor(100, 200);
    store.updateSelection(['elem-1']);
    store.updateViewport({ scrollX: 0, scrollY: 0, zoom: 1 });
  });

  it('should return remote selections for an element', () => {
    const store = useCollaborationStore.getState();

    // Manually set connected users
    useCollaborationStore.setState({
      connectedUsers: [
        {
          id: 'user-2',
          name: 'Bob',
          color: '#FF6B6B',
          cursor: null,
          selectedElementIds: ['elem-1', 'elem-2'],
          viewport: null,
          diagramId: 'diagram-1',
        },
        {
          id: 'user-3',
          name: 'Carol',
          color: '#4ECDC4',
          cursor: null,
          selectedElementIds: ['elem-2', 'elem-3'],
          viewport: null,
          diagramId: 'diagram-1',
        },
      ],
    });

    const selectionsForElem1 = store.getRemoteSelectionsForElement('elem-1');
    expect(selectionsForElem1).toHaveLength(1);
    expect(selectionsForElem1[0].name).toBe('Bob');

    const selectionsForElem2 = store.getRemoteSelectionsForElement('elem-2');
    expect(selectionsForElem2).toHaveLength(2);

    const selectionsForElem4 = store.getRemoteSelectionsForElement('elem-4');
    expect(selectionsForElem4).toHaveLength(0);
  });

  it('should return active users in a diagram', () => {
    useCollaborationStore.setState({
      connectedUsers: [
        {
          id: 'user-2',
          name: 'Bob',
          color: '#FF6B6B',
          cursor: null,
          selectedElementIds: [],
          viewport: null,
          diagramId: 'diagram-1',
        },
        {
          id: 'user-3',
          name: 'Carol',
          color: '#4ECDC4',
          cursor: null,
          selectedElementIds: [],
          viewport: null,
          diagramId: 'diagram-2',
        },
      ],
    });

    const store = useCollaborationStore.getState();
    const d1Users = store.getActiveUsersInDiagram('diagram-1');
    expect(d1Users).toHaveLength(1);
    expect(d1Users[0].name).toBe('Bob');

    const d2Users = store.getActiveUsersInDiagram('diagram-2');
    expect(d2Users).toHaveLength(1);
    expect(d2Users[0].name).toBe('Carol');
  });

  it('should sync element to Y.js', () => {
    const store = useCollaborationStore.getState();
    store.connect('diagram-1', 'user-1', 'Alice');

    const doc = useCollaborationStore.getState().doc!;
    const elementsMap = doc.getMap('elements');

    const element = {
      id: 'elem-1',
      type: 'rectangle' as const,
      diagramId: 'diagram-1',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#1e1e1e',
      backgroundColor: 'transparent',
      fillStyle: 'none' as const,
      strokeWidth: 2,
      strokeStyle: 'solid' as const,
      roughness: 1,
      seed: 12345,
      renderMode: 'sketchy' as const,
      opacity: 100,
      angle: 0,
      layerId: 'default',
      groupIds: [],
      isLocked: false,
      isDeleted: false,
      boundElements: [],
      version: 1,
      updatedAt: Date.now(),
      roundness: 0,
    };

    store.syncElementToYjs(element);

    const yElement = elementsMap.get('elem-1');
    expect(yElement).toBeDefined();
  });

  it('should delete element from Y.js', () => {
    const store = useCollaborationStore.getState();
    store.connect('diagram-1', 'user-1', 'Alice');

    const doc = useCollaborationStore.getState().doc!;
    const elementsMap = doc.getMap('elements');

    // Add an element first via the store's syncElementToYjs
    const element = {
      id: 'elem-to-delete',
      type: 'rectangle' as const,
      diagramId: 'diagram-1',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      strokeColor: '#1e1e1e',
      backgroundColor: 'transparent',
      fillStyle: 'none' as const,
      strokeWidth: 2,
      strokeStyle: 'solid' as const,
      roughness: 1,
      seed: 67890,
      renderMode: 'sketchy' as const,
      opacity: 100,
      angle: 0,
      layerId: 'default',
      groupIds: [],
      isLocked: false,
      isDeleted: false,
      boundElements: [],
      version: 1,
      updatedAt: Date.now(),
      roundness: 0,
    };

    store.syncElementToYjs(element);
    expect(elementsMap.has('elem-to-delete')).toBe(true);

    // Delete it
    store.deleteElementFromYjs('elem-to-delete');
    // A tombstone with a newer version, so stale copies can't bring it back
    const tomb = elementsMap.get('elem-to-delete') as { get: (k: string) => unknown };
    expect(tomb.get('isDeleted')).toBe(true);
    expect(tomb.get('version')).toBe(2);
  });

  describe('sync integrity', () => {
    type MockProvider = {
      triggerConnect: () => void;
      triggerSync: () => void;
      triggerAuthFailed: () => void;
      connect: ReturnType<typeof vi.fn>;
    };
    const mock = () => useCollaborationStore.getState().provider as unknown as MockProvider;
    const rect = (id: string, extra: Record<string, unknown> = {}) =>
      ({
        ...useElementsStore.getState().createElement('rectangle', 'diagram-1', 0, 0, 10, 10),
        id,
        ...extra,
      }) as never;

    it('is not "live" until authenticated and synced', () => {
      useCollaborationStore.getState().connect('diagram-1', 'user-1', 'Alice');
      const provider = mock();
      provider.triggerConnect();
      expect(useCollaborationStore.getState().connectionStatus).toBe('connecting');
      expect(isLiveSynced('diagram-1')).toBe(false);
      provider.triggerSync();
      expect(isLiveSynced('diagram-1')).toBe(true);
    });

    it('an auth rejection drops live status and retries with a fresh token', async () => {
      vi.useFakeTimers();
      try {
        useCollaborationStore.getState().connect('diagram-1', 'user-1', 'Alice');
        const provider = mock();
        provider.triggerSync();
        provider.triggerAuthFailed();
        expect(useCollaborationStore.getState().connectionStatus).toBe('disconnected');
        expect(isLiveSynced('diagram-1')).toBe(false);
        await vi.advanceTimersByTimeAsync(5000);
        expect(provider.connect).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('writes nothing into a fresh doc before the first sync', () => {
      useCollaborationStore.getState().connect('diagram-1', 'user-1', 'Alice');
      const doc = useCollaborationStore.getState().doc!;
      useElementsStore.getState().addElement(rect('early'));
      expect(doc.getMap('elements').has('early')).toBe(false);
      // …the first sync pushes it (it's newer than anything on the server)
      mock().triggerSync();
      expect(doc.getMap('elements').has('early')).toBe(true);
    });

    it('an element removed locally becomes a tombstone in the doc', () => {
      useCollaborationStore.getState().connect('diagram-1', 'user-1', 'Alice');
      mock().triggerSync();
      const doc = useCollaborationStore.getState().doc!;
      useElementsStore.getState().addElement(rect('gone', { version: 3 }));
      useElementsStore.getState().discardElements(['gone']);
      const entry = doc.getMap('elements').get('gone') as { get: (k: string) => unknown };
      expect(entry.get('isDeleted')).toBe(true);
      expect(entry.get('version')).toBe(4);
    });

    it('gives each person a stable colour', () => {
      expect(colorFor('user-1')).toBe(colorFor('user-1'));
      expect(new Set(['a', 'b', 'c', 'd', 'e'].map(colorFor)).size).toBeGreaterThan(1);
    });
  });
});

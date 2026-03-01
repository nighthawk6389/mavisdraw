import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock HocuspocusProvider before imports
vi.mock('@hocuspocus/provider', () => {
  return {
    HocuspocusProvider: vi.fn().mockImplementation((opts) => {
      const instance = {
        url: opts.url,
        name: opts.name,
        document: opts.document,
        destroy: vi.fn(),
        setAwarenessField: vi.fn(),
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
vi.mock('../../services/api', () => ({
  getAccessToken: vi.fn(() => 'mock-token'),
}));

import { useCollaborationStore } from '../collaborationStore';
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
      _applyingRemoteChanges: false,
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
    expect(elementsMap.has('elem-to-delete')).toBe(false);
  });
});

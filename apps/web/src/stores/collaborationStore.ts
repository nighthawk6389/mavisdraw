import { create } from 'zustand';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useElementsStore } from './elementsStore';
import { getAccessToken } from '../services/api';
import type { MavisElement, Viewport, ConnectionStatus } from '@mavisdraw/types';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3001';

export interface RemoteCursor {
  x: number;
  y: number;
  userId: string;
  userName: string;
  userColor: string;
  /** Previous position for interpolation */
  prevX: number;
  prevY: number;
  /** Timestamp when we received this update */
  timestamp: number;
  selectedElementIds: string[];
}

export interface CollaborationUser {
  id: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selectedElementIds: string[];
  viewport: Viewport | null;
  diagramId: string | null;
}

interface CollaborationState {
  connectionStatus: ConnectionStatus;
  provider: HocuspocusProvider | null;
  doc: Y.Doc | null;
  currentDiagramId: string | null;
  connectedUsers: CollaborationUser[];
  remoteCursors: Map<string, RemoteCursor>;
  /** ID of the user we're following (syncing viewport with) */
  followingUserId: string | null;
  /** Local user ID, set during connect */
  localUserId: string | null;
  /** Unsubscribe function for elementsStore listener */
  _elementsUnsubscribe: (() => void) | null;
  /** Flag to prevent sync loops: true when applying remote changes to Zustand */
  _applyingRemoteChanges: boolean;

  // Actions
  connect: (diagramId: string, userId: string, userName: string) => void;
  disconnect: () => void;
  switchRoom: (newDiagramId: string) => void;
  updateCursor: (x: number, y: number) => void;
  updateSelection: (elementIds: string[]) => void;
  updateViewport: (viewport: Viewport) => void;
  followUser: (userId: string | null) => void;
  syncElementToYjs: (element: MavisElement) => void;
  deleteElementFromYjs: (elementId: string) => void;
  getRemoteSelectionsForElement: (elementId: string) => CollaborationUser[];
  getActiveUsersInDiagram: (diagramId: string) => CollaborationUser[];
}

const USER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
  '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8C471', '#82E0AA', '#F0B27A', '#AED6F1',
];

function getRandomColor(): string {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

export const useCollaborationStore = create<CollaborationState>((set, get) => ({
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

  connect: (diagramId: string, userId: string, userName: string) => {
    const state = get();
    // Disconnect existing connection
    if (state.provider) {
      state.disconnect();
    }

    set({ connectionStatus: 'connecting', localUserId: userId });

    const doc = new Y.Doc();
    const token = getAccessToken();
    const userColor = getRandomColor();

    const provider = new HocuspocusProvider({
      url: WS_URL,
      name: `diagram:${diagramId}`,
      document: doc,
      token: token ?? undefined,

      onConnect() {
        set({ connectionStatus: 'connected' });
      },

      onDisconnect() {
        set({ connectionStatus: 'disconnected' });
      },

      onSynced() {
        // Initial sync complete — load remote elements into Zustand
        const elementsMap = doc.getMap('elements');
        if (elementsMap.size > 0) {
          set({ _applyingRemoteChanges: true });
          const elements = new Map<string, MavisElement>();
          elementsMap.forEach((value, key) => {
            if (value instanceof Y.Map) {
              elements.set(key, value.toJSON() as MavisElement);
            }
          });
          if (elements.size > 0) {
            useElementsStore.setState((prev) => {
              const next = new Map(prev.elements);
              for (const [id, el] of elements) {
                next.set(id, el);
              }
              return { elements: next };
            });
          }
          set({ connectionStatus: 'connected', _applyingRemoteChanges: false });
        }
      },

      onAwarenessUpdate({
        states,
      }: {
        states: Array<Record<string, unknown> & { clientId: number }>;
      }) {
        const users: CollaborationUser[] = [];
        const cursors = new Map<string, RemoteCursor>();
        const existingCursors = get().remoteCursors;

        for (const state of states) {
          const user = state.user as
            | { id?: string; name?: string; color?: string }
            | undefined;
          if (!user?.id || user.id === userId) continue;

          const cursor = state.cursor as { x?: number; y?: number } | undefined;
          const selectedIds = (state.selectedElementIds as string[]) ?? [];
          const viewport = state.viewport as Viewport | undefined;
          const remoteDiagramId = state.diagramId as string | undefined;

          users.push({
            id: user.id,
            name: user.name ?? 'Unknown',
            color: user.color ?? '#999',
            cursor:
              cursor?.x != null && cursor?.y != null
                ? { x: cursor.x, y: cursor.y }
                : null,
            selectedElementIds: selectedIds,
            viewport: viewport ?? null,
            diagramId: remoteDiagramId ?? null,
          });

          if (cursor?.x != null && cursor?.y != null) {
            const existing = existingCursors.get(user.id);
            cursors.set(user.id, {
              x: cursor.x,
              y: cursor.y,
              prevX: existing?.x ?? cursor.x,
              prevY: existing?.y ?? cursor.y,
              timestamp: Date.now(),
              userId: user.id,
              userName: user.name ?? 'Unknown',
              userColor: user.color ?? '#999',
              selectedElementIds: selectedIds,
            });
          }
        }

        set({ connectedUsers: users, remoteCursors: cursors });
      },
    });

    // Set local awareness fields
    provider.setAwarenessField('user', {
      id: userId,
      name: userName,
      color: userColor,
    });
    provider.setAwarenessField('diagramId', diagramId);

    // Listen for Y.js element changes from remote peers
    const elementsMap = doc.getMap('elements');
    elementsMap.observe((event) => {
      if (event.transaction.local) return;

      set({ _applyingRemoteChanges: true });
      event.changes.keys.forEach((change, key) => {
        if (change.action === 'add' || change.action === 'update') {
          const yElement = elementsMap.get(key);
          if (yElement && typeof yElement === 'object') {
            const element =
              yElement instanceof Y.Map
                ? (yElement.toJSON() as MavisElement)
                : (yElement as MavisElement);

            useElementsStore.setState((state) => {
              const next = new Map(state.elements);
              next.set(key, element);
              return { elements: next };
            });
          }
        } else if (change.action === 'delete') {
          useElementsStore.setState((state) => {
            const next = new Map(state.elements);
            next.delete(key);
            return { elements: next };
          });
        }
      });
      set({ _applyingRemoteChanges: false });
    });

    // Subscribe to Zustand elementsStore for automatic Zustand → Y.js sync
    const unsubscribe = useElementsStore.subscribe((newState, prevState) => {
      const currentGet = get();
      if (currentGet._applyingRemoteChanges || !currentGet.doc) return;

      const yDoc = currentGet.doc;
      const yElements = yDoc.getMap('elements');
      const newElements = newState.elements;
      const oldElements = prevState.elements;

      // Batch Y.js changes in a single transaction
      yDoc.transact(() => {
        // Find added or updated elements
        for (const [id, el] of newElements) {
          if (el.diagramId !== currentGet.currentDiagramId) continue;
          const old = oldElements.get(id);
          if (!old || old.version !== el.version || old.updatedAt !== el.updatedAt) {
            const yElement = new Y.Map();
            for (const [key, value] of Object.entries(el)) {
              yElement.set(key, value);
            }
            yElements.set(id, yElement);
          }
        }

        // Find deleted elements (soft-deleted or removed from map)
        for (const [id, el] of oldElements) {
          if (el.diagramId !== currentGet.currentDiagramId) continue;
          const newEl = newElements.get(id);
          if (!newEl) {
            yElements.delete(id);
          } else if (newEl.isDeleted && !el.isDeleted) {
            // Sync soft-delete
            const yElement = new Y.Map();
            for (const [key, value] of Object.entries(newEl)) {
              yElement.set(key, value);
            }
            yElements.set(id, yElement);
          }
        }
      });
    });

    set({
      provider,
      doc,
      currentDiagramId: diagramId,
      _elementsUnsubscribe: unsubscribe,
    });
  },

  disconnect: () => {
    const state = get();
    if (state._elementsUnsubscribe) {
      state._elementsUnsubscribe();
    }
    if (state.provider) {
      state.provider.destroy();
    }
    set({
      connectionStatus: 'disconnected',
      provider: null,
      doc: null,
      currentDiagramId: null,
      connectedUsers: [],
      remoteCursors: new Map(),
      followingUserId: null,
      _elementsUnsubscribe: null,
      _applyingRemoteChanges: false,
    });
  },

  switchRoom: (newDiagramId: string) => {
    const state = get();
    if (!state.localUserId || state.currentDiagramId === newDiagramId) return;

    const userId = state.localUserId;
    const user = state.connectedUsers.find((u) => u.id === userId);
    const userName = user?.name ?? 'User';

    // Disconnect from current room and connect to new one
    state.disconnect();
    // Small delay to allow cleanup, then reconnect
    setTimeout(() => {
      get().connect(newDiagramId, userId, userName);
    }, 50);
  },

  updateCursor: (x: number, y: number) => {
    const { provider } = get();
    if (!provider) return;
    provider.setAwarenessField('cursor', { x, y });
  },

  updateSelection: (elementIds: string[]) => {
    const { provider } = get();
    if (!provider) return;
    provider.setAwarenessField('selectedElementIds', elementIds);
  },

  updateViewport: (viewport: Viewport) => {
    const { provider } = get();
    if (!provider) return;
    provider.setAwarenessField('viewport', viewport);
  },

  followUser: (userId: string | null) => {
    set({ followingUserId: userId });
  },

  syncElementToYjs: (element: MavisElement) => {
    const { doc } = get();
    if (!doc) return;

    const elementsMap = doc.getMap('elements');
    const yElement = new Y.Map();
    for (const [key, value] of Object.entries(element)) {
      yElement.set(key, value);
    }
    elementsMap.set(element.id, yElement);
  },

  deleteElementFromYjs: (elementId: string) => {
    const { doc } = get();
    if (!doc) return;

    const elementsMap = doc.getMap('elements');
    elementsMap.delete(elementId);
  },

  getRemoteSelectionsForElement: (elementId: string): CollaborationUser[] => {
    const { connectedUsers } = get();
    return connectedUsers.filter((u) => u.selectedElementIds.includes(elementId));
  },

  getActiveUsersInDiagram: (diagramId: string): CollaborationUser[] => {
    const { connectedUsers } = get();
    return connectedUsers.filter((u) => u.diagramId === diagramId);
  },
}));

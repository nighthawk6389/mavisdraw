import { create } from 'zustand';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useElementsStore, applyRemoteChanges } from './elementsStore';
import { docVersion, readElement, writeElement } from '../collab/ydocElements';

/** True while remote changes are being written into the store (no echo back). */
let applyingRemote = false;

/** True when the diagram's elements are persisted by the live collaboration room. */
export function isLiveSynced(diagramId: string): boolean {
  const s = useCollaborationStore.getState();
  return s.connectionStatus === 'connected' && s.syncedDiagramId === diagramId;
}
import { getAccessToken } from '../services/api';
import type { MavisElement, Viewport, ConnectionStatus } from '@mavisdraw/types';

/**
 * WebSocket endpoint of the collaboration server. Accepts VITE_WS_URL or
 * VITE_API_URL in any form (http(s)/ws(s), with or without the path) and
 * always returns ws(s)://host/collaboration — the server's route.
 */
export function collaborationUrl(
  wsUrl: string | undefined = import.meta.env.VITE_WS_URL,
  apiUrl: string | undefined = import.meta.env.VITE_API_URL,
): string {
  const url = new URL(wsUrl || apiUrl || 'http://localhost:3001');
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  if (!url.pathname.replace(/\/+$/, '').endsWith('/collaboration')) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/collaboration`;
  }
  return url.toString();
}

const WS_URL = collaborationUrl();

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
  /** Diagram whose room has completed its initial sync (Y.js persists it). */
  syncedDiagramId: string | null;

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
  syncedDiagramId: null,

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
        set({ connectionStatus: 'disconnected', syncedDiagramId: null });
      },

      onSynced() {
        // Two-way initial sync, newest version wins per element:
        // remote → store, then local-only / newer local → doc
        const yElements = doc.getMap('elements');
        applyingRemote = true;
        try {
          applyRemoteChanges(() =>
            useElementsStore.setState((prev) => {
              const next = new Map(prev.elements);
              let changed = false;
              yElements.forEach((value, id) => {
                const remote = readElement(value);
                if (!remote) return;
                const local = next.get(id);
                if (!local || local.version < remote.version) {
                  next.set(id, remote);
                  changed = true;
                }
              });
              return changed ? { elements: next } : prev;
            }),
          );
        } finally {
          applyingRemote = false;
        }
        doc.transact(() => {
          for (const el of useElementsStore.getState().elements.values()) {
            if (el.diagramId !== diagramId) continue;
            if (el.version > docVersion(yElements, el.id)) writeElement(yElements, el);
          }
        });
        set({ connectionStatus: 'connected', syncedDiagramId: diagramId });
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

    // Remote → store: observe nested changes too (property-level updates)
    const elementsMap = doc.getMap('elements');
    elementsMap.observeDeep((events, transaction) => {
      if (transaction.local) return;
      const changed = new Set<string>();
      for (const event of events) {
        if (event.target === elementsMap) {
          event.changes.keys.forEach((_change, key) => changed.add(key));
        } else if (typeof event.path[0] === 'string') {
          changed.add(event.path[0]);
        }
      }
      if (changed.size === 0) return;
      applyingRemote = true;
      try {
        applyRemoteChanges(() =>
          useElementsStore.setState((state) => {
            const next = new Map(state.elements);
            for (const id of changed) {
              const element = readElement(elementsMap.get(id));
              if (element) next.set(id, element);
              else next.delete(id);
            }
            return { elements: next };
          }),
        );
      } finally {
        applyingRemote = false;
      }
    });

    // Store → Y.js: write only the elements (and properties) that changed
    const unsubscribe = useElementsStore.subscribe((newState, prevState) => {
      if (applyingRemote || newState.elements === prevState.elements) return;
      const currentDiagramId = get().currentDiagramId;
      const yElements = doc.getMap('elements');
      const prevElements = prevState.elements;
      doc.transact(() => {
        for (const [id, el] of newState.elements) {
          if (el.diagramId !== currentDiagramId || prevElements.get(id) === el) continue;
          writeElement(yElements, el);
        }
        for (const [id, el] of prevElements) {
          if (el.diagramId !== currentDiagramId || newState.elements.has(id)) continue;
          yElements.delete(id);
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
      syncedDiagramId: null,
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
    doc.transact(() => writeElement(doc.getMap('elements'), element));
  },

  deleteElementFromYjs: (elementId: string) => {
    const { doc } = get();
    if (!doc) return;
    doc.getMap('elements').delete(elementId);
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

import { create } from 'zustand';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useElementsStore, applyRemoteChanges } from './elementsStore';
import { docVersion, readElement, writeElement } from '../collab/ydocElements';
import { useCommentsStore } from './commentsStore';
import { useProposalsStore } from './proposalsStore';
import { usePresentStore } from './presentStore';
import { useDiagramStore } from './diagramStore';
import { refreshDiagramList } from '../services/diagramSync';
import { acknowledge } from '../services/offlineJournal';
import { useNotificationStore } from './notificationStore';

/** True while remote changes are being written into the store (no echo back). */
let applyingRemote = false;

/** True when the diagram's elements are persisted by the live collaboration room. */
export function isLiveSynced(diagramId: string): boolean {
  const s = useCollaborationStore.getState();
  return (
    s.connectionStatus === 'connected' &&
    s.syncedDiagramId === diagramId &&
    s.provider?.isAuthenticated === true
  );
}

const MAX_AUTH_RETRIES = 3;

/**
 * Re-read our role in the open project (after a permission change or a
 * refused connection). Removed from the project: say so and leave.
 */
async function refreshProjectRole(): Promise<boolean> {
  const projectId = useCommentsStore.getState().projectId;
  if (!projectId) return true;
  try {
    const { project } = await apiGetProject(projectId);
    usePermissionStore.getState().setRole((project.role as ProjectRole | undefined) ?? 'viewer');
    return true;
  } catch (err) {
    if (err instanceof ApiError && (err.statusCode === 403 || err.statusCode === 404)) {
      useCollaborationStore.getState().disconnect();
      toast('You no longer have access to this project.', 'error');
      navigate('/');
      return false;
    }
    return true; // offline or a server hiccup: keep trying
  }
}
import {
  ApiError,
  apiGetProject,
  forceRefreshAccessToken,
  getFreshAccessToken,
} from '../services/api';
import { usePermissionStore, type ProjectRole } from './permissionStore';
import { toast } from './toastStore';
import { navigate } from '../routing';
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
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#FFA07A',
  '#98D8C8',
  '#F7DC6F',
  '#BB8FCE',
  '#85C1E9',
  '#F8C471',
  '#82E0AA',
  '#F0B27A',
  '#AED6F1',
];

/**
 * Pointer moves and pans fire up to 60+ times a second; every awareness
 * change is broadcast to (and re-rendered by) everyone in the room. Send at
 * most ~20 per second per field, always ending with the latest value.
 */
const AWARENESS_INTERVAL_MS = 50;
const pendingAwareness = new Map<
  string,
  { value: unknown; timer: ReturnType<typeof setTimeout> | null; last: number }
>();

function throttledAwareness(provider: HocuspocusProvider, field: string, value: unknown): void {
  const entry = pendingAwareness.get(field) ?? { value, timer: null, last: 0 };
  entry.value = value;
  pendingAwareness.set(field, entry);
  const wait = AWARENESS_INTERVAL_MS - (Date.now() - entry.last);
  if (wait <= 0 && !entry.timer) {
    entry.last = Date.now();
    provider.setAwarenessField(field, value);
    return;
  }
  if (entry.timer) return;
  entry.timer = setTimeout(
    () => {
      entry.timer = null;
      entry.last = Date.now();
      provider.setAwarenessField(field, entry.value);
    },
    Math.max(0, wait),
  );
}

/** A stable colour per person, so it doesn't change every time they drill in. */
export function colorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
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
    const userColor = colorFor(userId);
    // Local edits are written to the doc only after the first sync: writing
    // into a fresh, empty doc would duplicate every element already on the
    // server. Reconnects keep writing (the doc holds the state; Y merges).
    let initialSyncDone = false;
    let authFailures = 0;

    const provider = new HocuspocusProvider({
      url: WS_URL,
      name: `diagram:${diagramId}`,
      document: doc,
      // Asked for on every (re)connect, so a long session never presents an
      // expired token after a server restart or a network drop
      token: async () => (await getFreshAccessToken()) ?? '',

      onConnect() {
        // The socket is open; we're not live until authenticated and synced
        set({ connectionStatus: 'connecting' });
      },

      onAuthenticationFailed() {
        set({ connectionStatus: 'disconnected', syncedDiagramId: null });
        // The provider gives up after a rejection. Either we lost access to
        // the project (then leave), or our token went stale (then refresh it
        // and rejoin, a few times with backoff).
        void refreshProjectRole().then((stillMember) => {
          if (!stillMember || authFailures >= MAX_AUTH_RETRIES) return;
          authFailures += 1;
          const delay = 250 * 2 ** authFailures;
          void forceRefreshAccessToken().then(() => {
            setTimeout(() => {
              if (get().provider === provider) void provider.connect();
            }, delay);
          });
        });
      },

      onDisconnect() {
        set({ connectionStatus: 'disconnected', syncedDiagramId: null });
      },

      onClose({ event }) {
        set({ connectionStatus: 'disconnected', syncedDiagramId: null });
        // 4403: the server closed us because our access changed. The provider
        // won't retry on its own; find out where we stand.
        if (event?.code === 4403) {
          void refreshProjectRole().then((stillMember) => {
            if (stillMember && get().provider === provider) void provider.connect();
          });
        }
      },

      onSynced() {
        authFailures = 0;
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
        initialSyncDone = true;
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
          const user = state.user as { id?: string; name?: string; color?: string } | undefined;
          if (!user?.id || user.id === userId) continue;

          const cursor = state.cursor as { x?: number; y?: number } | undefined;
          const selectedIds = (state.selectedElementIds as string[]) ?? [];
          const viewport = state.viewport as Viewport | undefined;
          const remoteDiagramId = state.diagramId as string | undefined;

          users.push({
            id: user.id,
            name: user.name ?? 'Unknown',
            color: user.color ?? '#999',
            cursor: cursor?.x != null && cursor?.y != null ? { x: cursor.x, y: cursor.y } : null,
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

    // Everything we sent has been acknowledged: those edits are safe on the
    // server, so they no longer need the on-device journal
    provider.on('unsyncedChanges', (count: number) => {
      if (count === 0 && initialSyncDone && get().provider === provider) acknowledge(diagramId);
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
      // A teammate drew a portal: fetch the nested diagram behind it
      const diagrams = useDiagramStore.getState().diagrams;
      for (const id of changed) {
        const target = (elementsMap.get(id) as Y.Map<unknown> | undefined)?.get?.(
          'targetDiagramId',
        );
        if (typeof target === 'string' && target && !diagrams.has(target)) {
          void refreshDiagramList();
          break;
        }
      }
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

    // Side-channel nudges from the server (e.g. a comment was posted)
    doc.getMap('signals').observe((event, transaction) => {
      if (transaction.local) return;
      if (event.keysChanged.has('comments')) {
        void useCommentsStore.getState().refresh();
        void useNotificationStore.getState().load();
      }
      if (event.keysChanged.has('proposals')) void useProposalsStore.getState().refresh();
      if (event.keysChanged.has('tour')) void usePresentStore.getState().loadTour();
      if (event.keysChanged.has('presentation')) void usePresentStore.getState().refreshRemote();
      // Someone's access to the project changed (maybe ours)
      if (event.keysChanged.has('permissions')) void refreshProjectRole();
    });

    // Store → Y.js: write only the elements (and properties) that changed
    const unsubscribe = useElementsStore.subscribe((newState, prevState) => {
      if (applyingRemote || !initialSyncDone || newState.elements === prevState.elements) return;
      const currentDiagramId = get().currentDiagramId;
      const yElements = doc.getMap('elements');
      const prevElements = prevState.elements;
      doc.transact(() => {
        for (const [id, el] of newState.elements) {
          if (el.diagramId !== currentDiagramId || prevElements.get(id) === el) continue;
          writeElement(yElements, el);
        }
        // An element that vanished locally becomes a tombstone, never a
        // missing key: otherwise a teammate's stale copy brings it back
        for (const [id, el] of prevElements) {
          if (el.diagramId !== currentDiagramId || newState.elements.has(id)) continue;
          const entry = yElements.get(id);
          if (!(entry instanceof Y.Map) || entry.get('isDeleted') === true) continue;
          entry.set('isDeleted', true);
          entry.set('version', Math.max(Number(entry.get('version') ?? 0), el.version) + 1);
          entry.set('updatedAt', Date.now());
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
    throttledAwareness(provider, 'cursor', { x, y });
  },

  updateSelection: (elementIds: string[]) => {
    const { provider } = get();
    if (!provider) return;
    provider.setAwarenessField('selectedElementIds', elementIds);
  },

  updateViewport: (viewport: Viewport) => {
    const { provider } = get();
    if (!provider) return;
    throttledAwareness(provider, 'viewport', viewport);
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
    const entry = doc.getMap('elements').get(elementId);
    if (!(entry instanceof Y.Map)) return;
    doc.transact(() => {
      entry.set('isDeleted', true);
      entry.set('version', Number(entry.get('version') ?? 0) + 1);
      entry.set('updatedAt', Date.now());
    });
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

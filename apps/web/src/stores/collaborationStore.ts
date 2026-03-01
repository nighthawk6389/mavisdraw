import { create } from 'zustand';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useElementsStore } from './elementsStore';
import { getAccessToken } from '../services/api';
import type { MavisElement } from '@mavisdraw/types';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3001';

export interface RemoteCursor {
  x: number;
  y: number;
  userId: string;
  userName: string;
  userColor: string;
  selectedElementIds: string[];
}

export interface CollaborationUser {
  id: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selectedElementIds: string[];
}

interface CollaborationState {
  isConnected: boolean;
  provider: HocuspocusProvider | null;
  doc: Y.Doc | null;
  connectedUsers: CollaborationUser[];
  remoteCursors: Map<string, RemoteCursor>;

  // Actions
  connect: (diagramId: string, userId: string, userName: string) => void;
  disconnect: () => void;
  updateCursor: (x: number, y: number) => void;
  updateSelection: (elementIds: string[]) => void;
  syncElementToYjs: (element: MavisElement) => void;
  deleteElementFromYjs: (elementId: string) => void;
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
  isConnected: false,
  provider: null,
  doc: null,
  connectedUsers: [],
  remoteCursors: new Map(),

  connect: (diagramId: string, userId: string, userName: string) => {
    const state = get();
    // Disconnect existing connection
    if (state.provider) {
      state.provider.destroy();
    }

    const doc = new Y.Doc();
    const token = getAccessToken();

    const provider = new HocuspocusProvider({
      url: WS_URL,
      name: `diagram:${diagramId}`,
      document: doc,
      token: token ?? undefined,

      onConnect() {
        set({ isConnected: true });
      },

      onDisconnect() {
        set({ isConnected: false });
      },

      onAwarenessUpdate({ states }: { states: Map<number, Record<string, unknown>> }) {
        const users: CollaborationUser[] = [];
        const cursors = new Map<string, RemoteCursor>();

        states.forEach((state, clientId) => {
          const user = state.user as { id?: string; name?: string; color?: string } | undefined;
          if (!user?.id || user.id === userId) return;

          const cursor = state.cursor as { x?: number; y?: number } | undefined;
          const selectedIds = (state.selectedElementIds as string[]) ?? [];

          users.push({
            id: user.id,
            name: user.name ?? 'Unknown',
            color: user.color ?? '#999',
            cursor: cursor?.x != null && cursor?.y != null ? { x: cursor.x, y: cursor.y } : null,
            selectedElementIds: selectedIds,
          });

          if (cursor?.x != null && cursor?.y != null) {
            cursors.set(user.id, {
              x: cursor.x,
              y: cursor.y,
              userId: user.id,
              userName: user.name ?? 'Unknown',
              userColor: user.color ?? '#999',
              selectedElementIds: selectedIds,
            });
          }
        });

        set({ connectedUsers: users, remoteCursors: cursors });
      },
    });

    // Set local awareness
    const userColor = getRandomColor();
    provider.setAwarenessField('user', {
      id: userId,
      name: userName,
      color: userColor,
    });

    // Listen for Y.js element changes from remote peers
    const elementsMap = doc.getMap('elements');
    elementsMap.observe((event) => {
      if (event.transaction.local) return;

      const elementsStore = useElementsStore.getState();

      event.changes.keys.forEach((change, key) => {
        if (change.action === 'add' || change.action === 'update') {
          const yElement = elementsMap.get(key);
          if (yElement && typeof yElement === 'object') {
            const element =
              yElement instanceof Y.Map
                ? (yElement.toJSON() as MavisElement)
                : (yElement as MavisElement);

            // Apply remote change without pushing to history
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
    });

    set({ provider, doc });
  },

  disconnect: () => {
    const state = get();
    if (state.provider) {
      state.provider.destroy();
    }
    set({
      isConnected: false,
      provider: null,
      doc: null,
      connectedUsers: [],
      remoteCursors: new Map(),
    });
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
}));

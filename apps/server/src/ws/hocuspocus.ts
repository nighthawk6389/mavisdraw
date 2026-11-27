import { Hocuspocus } from '@hocuspocus/server';
import { verifyAccessToken } from '../services/authService.js';
import { getDiagram, updateDiagram, checkProjectAccess } from '../services/diagramService.js';
import type * as Y from 'yjs';
import {
  applyState,
  encodeState,
  readLiveElements,
  seedElements,
  type ElementJSON,
} from './ydocElements.js';

export const DOCUMENT_PREFIX = 'diagram:';

export function documentNameFor(diagramId: string): string {
  return `${DOCUMENT_PREFIX}${diagramId}`;
}

/** Per-socket state shared with onAuthenticate through the connection context. */
export interface SocketGate {
  authenticated: boolean;
}

type ProjectRole = 'owner' | 'admin' | 'editor' | 'viewer';

/**
 * Apply a permission change to connections that are already open (access is
 * otherwise only checked when a socket connects): someone removed from the
 * project is disconnected, someone downgraded to viewer stops being able to
 * write, and everyone in the project's rooms is told to refresh their role.
 */
export function applyAccessChange(
  server: Pick<Hocuspocus, 'documents'>,
  projectId: string,
  userId: string,
  access: ProjectRole | null,
): number {
  let affected = 0;
  server.documents.forEach((document) => {
    let inProject = false;
    document.connections.forEach(({ connection }) => {
      const user = (connection.context as { user?: { id?: string; projectId?: string } }).user;
      if (user?.projectId !== projectId) return;
      inProject = true;
      if (user.id !== userId) return;
      affected++;
      if (access === null) {
        // Connection.close() only detaches from the document (the client would
        // never know, and could keep sending): close the socket itself
        connection.close({ code: 4403, reason: 'Access revoked' });
        connection.webSocket.close(4403, 'Access revoked');
      } else {
        connection.readOnly = access === 'viewer';
      }
    });
    if (inProject) {
      const signals = document.getMap('signals');
      signals.set('permissions', Number(signals.get('permissions') ?? 0) + 1);
    }
  });
  return affected;
}

/**
 * Something changed who can reach the whole project (it moved between
 * workspaces, or stopped being public): recompute access for everyone
 * connected to its rooms and apply it to their open sockets.
 */
export async function reapplyProjectAccess(
  server: Pick<Hocuspocus, 'documents'>,
  projectId: string,
  accessOf: (projectId: string, userId: string) => Promise<ProjectRole | null> = checkProjectAccess,
): Promise<void> {
  const connected = new Set<string>();
  server.documents.forEach((document) => {
    document.connections.forEach(({ connection }) => {
      const user = (connection.context as { user?: { id?: string; projectId?: string } }).user;
      if (user?.projectId === projectId && user.id) connected.add(user.id);
    });
  });
  for (const userId of connected) {
    applyAccessChange(server, projectId, userId, await accessOf(projectId, userId));
  }
}

/**
 * Nudge everyone in a diagram's live room that some side data changed
 * (e.g. comments), so they refetch it right away instead of polling.
 */
export function signalDocument(
  server: Pick<Hocuspocus, 'documents'>,
  diagramId: string,
  key: string,
): void {
  const doc = server.documents.get(documentNameFor(diagramId));
  if (!doc) return;
  const signals = doc.getMap('signals');
  signals.set(key, Number(signals.get(key) ?? 0) + 1);
}

/** Write a live document to the database: readable JSON (REST, exports) plus the CRDT state. */
export async function persistDocument(documentName: string, document: Y.Doc): Promise<void> {
  const diagramId = documentName.replace(DOCUMENT_PREFIX, '');
  await updateDiagram(diagramId, {
    elements: readLiveElements(document),
    yjsState: encodeState(document),
  });
}

/**
 * Persist every open document now, bypassing the store debounce. Called on
 * shutdown so a deploy never drops the last few seconds of live edits.
 */
export async function persistOpenDocuments(server: Pick<Hocuspocus, 'documents'>): Promise<void> {
  const pending: Promise<void>[] = [];
  server.documents.forEach((document, name) => {
    // A document still loading holds nothing worth saving (and would overwrite)
    if (document.isLoading) return;
    pending.push(
      persistDocument(name, document).catch((err) => {
        console.error(`Failed to persist ${name} on shutdown:`, err);
      }),
    );
  });
  await Promise.all(pending);
}

export function createHocuspocusServer(): Hocuspocus {
  const server = new Hocuspocus({
    port: 0, // Don't listen on its own port — we attach to Fastify

    async onAuthenticate({ token, documentName, connection, context }) {
      if (!token) {
        throw new Error('Authentication required');
      }

      const payload = verifyAccessToken(token);

      const diagramId = documentName.replace(DOCUMENT_PREFIX, '');
      const diagram = await getDiagram(diagramId);
      if (!diagram) {
        throw new Error('Diagram not found');
      }

      const access = await checkProjectAccess(diagram.projectId, payload.userId);
      if (!access) {
        throw new Error('Access denied');
      }

      // Viewers can watch live but their updates are rejected server-side
      connection.readOnly = access === 'viewer';
      // The socket may now send document data freely (see the pre-auth cap)
      const gate = (context as { gate?: SocketGate }).gate;
      if (gate) gate.authenticated = true;

      return {
        user: {
          id: payload.userId,
          email: payload.email,
          role: access,
          projectId: diagram.projectId,
        },
      };
    },

    async onLoadDocument({ document, documentName }) {
      const diagramId = documentName.replace(DOCUMENT_PREFIX, '');
      const diagram = await getDiagram(diagramId);
      if (!diagram) return document;

      if (diagram.yjsState) {
        // Resume the CRDT exactly where the last session left it
        applyState(document, diagram.yjsState);
      } else if (Array.isArray(diagram.elements)) {
        seedElements(document, diagram.elements as ElementJSON[]);
      }

      const appState = document.getMap('appState');
      appState.set('viewBackgroundColor', diagram.viewBackgroundColor);
      appState.set('gridEnabled', diagram.gridEnabled);
      appState.set('gridSize', diagram.gridSize);
      appState.set('renderMode', diagram.renderMode);

      return document;
    },

    async onStoreDocument({ documentName, document }) {
      await persistDocument(documentName, document);
    },

    // Debounce persistence to avoid too many writes
    debounce: 2000,
    maxDebounce: 10000,
  });

  return server;
}

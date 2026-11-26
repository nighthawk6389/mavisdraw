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

    async onAuthenticate({ token, documentName, connection }) {
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

      return {
        user: {
          id: payload.userId,
          email: payload.email,
          role: access,
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

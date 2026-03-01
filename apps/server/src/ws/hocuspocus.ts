import { Hocuspocus } from '@hocuspocus/server';
import { verifyAccessToken } from '../services/authService.js';
import { getDiagram, updateDiagram, checkProjectAccess } from '../services/diagramService.js';

export function createHocuspocusServer() {
  const server = new Hocuspocus({
    port: 0, // Don't listen on its own port — we attach to Fastify

    async onAuthenticate({ token, documentName }) {
      if (!token) {
        throw new Error('Authentication required');
      }

      const payload = verifyAccessToken(token);

      // documentName format: "diagram:<diagramId>"
      const diagramId = documentName.replace('diagram:', '');
      const diagram = await getDiagram(diagramId);
      if (!diagram) {
        throw new Error('Diagram not found');
      }

      const access = await checkProjectAccess(diagram.projectId, payload.userId);
      if (!access) {
        throw new Error('Access denied');
      }

      return {
        user: {
          id: payload.userId,
          email: payload.email,
          role: access,
        },
      };
    },

    async onLoadDocument({ document, documentName }) {
      const diagramId = documentName.replace('diagram:', '');
      const diagram = await getDiagram(diagramId);

      if (diagram) {
        // Load existing elements into the Y.Doc
        const elementsMap = document.getMap('elements');
        const elements = diagram.elements as Record<string, unknown>[];

        if (Array.isArray(elements)) {
          for (const element of elements) {
            const el = element as { id?: string };
            if (el.id) {
              const elementMap = new (await import('yjs')).Map();
              for (const [key, value] of Object.entries(element)) {
                elementMap.set(key, value);
              }
              elementsMap.set(el.id, elementMap);
            }
          }
        }

        // Load app state
        const appState = document.getMap('appState');
        appState.set('viewBackgroundColor', diagram.viewBackgroundColor);
        appState.set('gridEnabled', diagram.gridEnabled);
        appState.set('gridSize', diagram.gridSize);
        appState.set('renderMode', diagram.renderMode);
      }

      return document;
    },

    async onStoreDocument({ documentName, document }) {
      const diagramId = documentName.replace('diagram:', '');

      // Convert Y.js elements map back to array
      const elementsMap = document.getMap('elements');
      const elements: Record<string, unknown>[] = [];

      elementsMap.forEach((value, key) => {
        if (value instanceof (globalThis as any).Map || (value && typeof value === 'object' && 'toJSON' in value)) {
          elements.push((value as any).toJSON());
        } else {
          elements.push(value as Record<string, unknown>);
        }
      });

      // Get app state
      const appState = document.getMap('appState');

      await updateDiagram(diagramId, {
        elements,
        viewBackgroundColor: (appState.get('viewBackgroundColor') as string) ?? '#ffffff',
        gridEnabled: (appState.get('gridEnabled') as boolean) ?? true,
        gridSize: (appState.get('gridSize') as number) ?? 20,
        renderMode: (appState.get('renderMode') as string) ?? 'sketchy',
      });
    },

    // Debounce persistence to avoid too many writes
    debounce: 2000,
    maxDebounce: 10000,
  });

  return server;
}

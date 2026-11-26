import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { diagrams } from '../db/schema.js';
import {
  createDiagram,
  getDiagram,
  getDiagramsByProject,
  updateDiagram,
  deleteDiagram,
  createSnapshot,
  getSnapshots,
  getSnapshot,
  checkProjectAccess,
} from '../services/diagramService.js';
import { requireAuth } from '../middleware/auth.js';
import { documentNameFor } from '../ws/hocuspocus.js';
import {
  mergeElements,
  readLiveElements,
  replaceElements,
  type ElementJSON,
} from '../ws/ydocElements.js';
import type { Document } from '@hocuspocus/server';

/** The open collaboration document for a diagram, if anyone is editing it live. */
function liveDocument(documents: Map<string, Document>, diagramId: string): Document | undefined {
  return documents.get(documentNameFor(diagramId));
}

/** Never send the CRDT blob to REST clients. */
function publicDiagram<T extends { yjsState?: string | null; createdAt: Date; updatedAt: Date }>(
  d: T,
) {
  const { yjsState: _yjsState, ...rest } = d;
  return { ...rest, createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString() };
}

/**
 * A diagram as REST clients should see it: while a live room is open its
 * contents are newer than the last debounced flush to the database.
 */
function currentDiagram<
  T extends { id: string; yjsState?: string | null; createdAt: Date; updatedAt: Date },
>(documents: Map<string, Document>, d: T) {
  const live = liveDocument(documents, d.id);
  const base = publicDiagram(d);
  if (!live) return base;
  return { ...base, elements: readLiveElements(live) };
}

/** Client-generated ids (nanoid) let the editor create nested diagrams offline-first. */
const diagramIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid diagram id');

const createDiagramSchema = z.object({
  id: diagramIdSchema.optional(),
  projectId: z.string().min(1),
  parentDiagramId: z.string().nullable().optional(),
  parentPortalId: z.string().nullable().optional(),
  title: z.string().min(1).max(255).optional(),
});

/** Upper bound on elements per diagram, to keep a single save bounded. */
const MAX_ELEMENTS_PER_DIAGRAM = 20_000;

const updateDiagramSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  elements: z.array(z.any()).max(MAX_ELEMENTS_PER_DIAGRAM).optional(),
  viewBackgroundColor: z.string().max(20).optional(),
  gridEnabled: z.boolean().optional(),
  gridSize: z.number().int().positive().optional(),
  renderMode: z.enum(['sketchy', 'clean']).optional(),
  layers: z.array(z.any()).max(100).optional(),
});

/** Diagrams carry inline images, so saves can be much larger than Fastify's 1MB default. */
const DIAGRAM_BODY_LIMIT = 25 * 1024 * 1024;

const createSnapshotSchema = z.object({
  trigger: z.enum(['auto', 'manual']).optional(),
  label: z.string().max(255).optional(),
});

export async function diagramRoutes(app: FastifyInstance): Promise<void> {
  // Create diagram
  app.post('/api/diagrams', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = createDiagramSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    const userId = request.user!.userId;
    const access = await checkProjectAccess(parsed.data.projectId, userId);
    if (!access || access === 'viewer') {
      return reply.code(403).send({ error: 'Access denied' });
    }

    // A child must live in the same project as its parent
    if (parsed.data.parentDiagramId) {
      const parent = await getDiagram(parsed.data.parentDiagramId);
      if (!parent || parent.projectId !== parsed.data.projectId) {
        return reply.code(400).send({ error: 'Parent diagram not found in this project' });
      }
    }

    // Idempotent create with a client id: retries return the existing diagram
    if (parsed.data.id) {
      const existing = await getDiagram(parsed.data.id);
      if (existing) {
        if (existing.projectId !== parsed.data.projectId) {
          return reply.code(409).send({ error: 'Diagram id already in use' });
        }
        return reply.code(200).send({ diagram: publicDiagram(existing) });
      }
    }

    const diagram = await createDiagram({
      id: parsed.data.id,
      projectId: parsed.data.projectId,
      parentDiagramId: parsed.data.parentDiagramId,
      parentPortalId: parsed.data.parentPortalId,
      title: parsed.data.title,
      userId,
    });

    return reply.code(201).send({
      diagram: publicDiagram(diagram!),
    });
  });

  // Get diagram
  app.get('/api/diagrams/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;

    const diagram = await getDiagram(id);
    if (!diagram) {
      return reply.code(404).send({ error: 'Diagram not found' });
    }

    const access = await checkProjectAccess(diagram.projectId, userId);
    if (!access) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    return reply.code(200).send({
      diagram: currentDiagram(app.hocuspocus.documents, diagram),
    });
  });

  // List diagrams by project
  app.get(
    '/api/projects/:projectId/diagrams',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const userId = request.user!.userId;

      const access = await checkProjectAccess(projectId, userId);
      if (!access) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const diagramList = await getDiagramsByProject(projectId);
      return reply.code(200).send({
        diagrams: diagramList.map((d) => currentDiagram(app.hocuspocus.documents, d)),
      });
    },
  );

  // Update diagram
  app.put(
    '/api/diagrams/:id',
    { preHandler: [requireAuth], bodyLimit: DIAGRAM_BODY_LIMIT },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;

      const parsed = updateDiagramSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }

      const existing = await getDiagram(id);
      if (!existing) {
        return reply.code(404).send({ error: 'Diagram not found' });
      }

      const access = await checkProjectAccess(existing.projectId, userId);
      if (!access || access === 'viewer') {
        return reply.code(403).send({ error: 'Access denied' });
      }

      // While people are editing live, the collaboration document is the
      // source of truth: merge into it (newer versions win) and let it persist,
      // instead of writing the row and being overwritten moments later.
      const { elements, ...metadata } = parsed.data;
      const live = liveDocument(app.hocuspocus.documents, id);
      let diagram;
      if (elements && live) {
        mergeElements(live, elements as ElementJSON[]);
        diagram = await updateDiagram(id, metadata);
      } else {
        // Direct write: the stored CRDT state is now stale, re-seed next session
        diagram = await updateDiagram(id, {
          ...metadata,
          ...(elements ? { elements, yjsState: null } : {}),
        });
      }
      if (!diagram) {
        return reply.code(404).send({ error: 'Diagram not found' });
      }

      return reply.code(200).send({
        diagram: publicDiagram(diagram!),
      });
    },
  );

  // Delete diagram
  app.delete('/api/diagrams/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;

    const existing = await getDiagram(id);
    if (!existing) {
      return reply.code(404).send({ error: 'Diagram not found' });
    }

    const access = await checkProjectAccess(existing.projectId, userId);
    if (!access || access === 'viewer') {
      return reply.code(403).send({ error: 'Access denied' });
    }

    await deleteDiagram(id);
    return reply.code(200).send({ message: 'Diagram deleted' });
  });

  // Save diagram (creates snapshot)
  app.post('/api/diagrams/:id/save', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;

    const parsed = createSnapshotSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    const existing = await getDiagram(id);
    if (!existing) {
      return reply.code(404).send({ error: 'Diagram not found' });
    }

    const access = await checkProjectAccess(existing.projectId, userId);
    if (!access || access === 'viewer') {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const live = liveDocument(app.hocuspocus.documents, id);
    const snapshot = await createSnapshot(
      id,
      userId,
      parsed.data.trigger ?? 'manual',
      parsed.data.label,
      live ? readLiveElements(live) : undefined,
    );

    return reply.code(201).send({
      snapshot: {
        ...snapshot,
        createdAt: snapshot.createdAt.toISOString(),
      },
    });
  });

  // Get snapshots for a diagram
  app.get('/api/diagrams/:id/snapshots', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;
    const query = request.query as { limit?: string; offset?: string };

    const existing = await getDiagram(id);
    if (!existing) {
      return reply.code(404).send({ error: 'Diagram not found' });
    }

    const access = await checkProjectAccess(existing.projectId, userId);
    if (!access) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const limit = Math.min(parseInt(query.limit ?? '50', 10), 100);
    const offset = parseInt(query.offset ?? '0', 10);

    const snapshotList = await getSnapshots(id, limit, offset);
    // The list is for browsing: counts, not whole element arrays
    return reply.code(200).send({
      snapshots: snapshotList.map((s) => ({
        id: s.id,
        diagramId: s.diagramId,
        version: s.version,
        label: s.label,
        trigger: s.trigger,
        createdBy: s.createdBy,
        elementCount: Array.isArray(s.elements) ? s.elements.length : 0,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  });

  // Restore snapshot
  app.post(
    '/api/diagrams/:id/snapshots/:snapshotId/restore',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id, snapshotId } = request.params as { id: string; snapshotId: string };
      const userId = request.user!.userId;

      const existing = await getDiagram(id);
      if (!existing) {
        return reply.code(404).send({ error: 'Diagram not found' });
      }

      const access = await checkProjectAccess(existing.projectId, userId);
      if (!access || access === 'viewer') {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const snapshot = await getSnapshot(snapshotId);
      if (!snapshot || snapshot.diagramId !== id) {
        return reply.code(404).send({ error: 'Snapshot not found' });
      }

      const live = liveDocument(app.hocuspocus.documents, id);
      const liveElements = () =>
        live ? readLiveElements(live) : undefined;

      // Create a new snapshot of current state before restoring
      await createSnapshot(id, userId, 'auto', 'Pre-restore backup', liveElements());

      // Restore the diagram from the snapshot
      const appState = snapshot.appState as Record<string, unknown>;
      const metadata = {
        viewBackgroundColor: appState.viewBackgroundColor as string | undefined,
        gridEnabled: appState.gridEnabled as boolean | undefined,
        gridSize: appState.gridSize as number | undefined,
        renderMode: appState.renderMode as string | undefined,
        layers: appState.layers as unknown[] | undefined,
      };
      let diagram;
      if (live) {
        // Everyone connected sees the restore immediately
        replaceElements(live, snapshot.elements as ElementJSON[]);
        diagram = await updateDiagram(id, metadata);
      } else {
        diagram = await updateDiagram(id, {
          ...metadata,
          elements: snapshot.elements as unknown[],
          yjsState: null,
        });
      }

      // Create a post-restore snapshot
      await createSnapshot(
        id,
        userId,
        'auto',
        'Restored from version ' + snapshot.version,
        liveElements(),
      );

      return reply.code(200).send({
        diagram: publicDiagram(diagram!),
      });
    },
  );
}

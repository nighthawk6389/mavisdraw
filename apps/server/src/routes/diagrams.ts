import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { diagrams, projects } from '../db/schema.js';
import {
  createDiagram,
  getDiagram,
  getDiagramSummaries,
  updateDiagram,
  deleteDiagram,
  createSnapshot,
  getSnapshots,
  getSnapshot,
  checkProjectAccess,
} from '../services/diagramService.js';
import { requireAuth } from '../middleware/auth.js';
import { loadedRoom } from '../ws/hocuspocus.js';
import {
  mergeElements,
  readLiveElements,
  replaceElements,
  type ElementJSON,
} from '../ws/ydocElements.js';
import {
  changeDiagramElements,
  openRoom,
  replaceStoredElements,
} from '../services/diagramContents.js';
import type { Document } from '@hocuspocus/server';

/**
 * The open collaboration document for a diagram, if anyone is editing it
 * live (and it has finished loading: until then the stored row is what it
 * holds).
 */
function liveDocument(documents: Map<string, Document>, diagramId: string): Document | undefined {
  return loadedRoom(documents, diagramId);
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
  /** Version of each element the client's edits are based on (enables conflict checks). */
  baseVersions: z.record(z.string(), z.number()).optional(),
  /** Elements the client deleted since its base. */
  deletedIds: z.array(z.string().max(64)).max(MAX_ELEMENTS_PER_DIAGRAM).optional(),
  viewBackgroundColor: z.string().max(20).optional(),
  gridEnabled: z.boolean().optional(),
  gridSize: z.number().int().positive().optional(),
  renderMode: z.enum(['sketchy', 'clean']).optional(),
  layers: z.array(z.any()).max(100).optional(),
});

/** Diagrams carry inline images, so saves can be much larger than Fastify's 1MB default. */
const DIAGRAM_BODY_LIMIT = 25 * 1024 * 1024;

const snapshotPageSchema = z.object({
  // Larger pages are capped rather than refused
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(50)
    .transform((n) => Math.min(n, 100)),
  offset: z.coerce.number().int().min(0).default(0),
});

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

    await openRoom(app.hocuspocus, id);
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

      const diagramList = await getDiagramSummaries(projectId);
      return reply.code(200).send({
        diagrams: diagramList.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        })),
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

      // Element writes are conflict-checked against each element's base
      // version: an edit applies only if nobody changed that element since
      // the client last saw it; otherwise it's reported back as a conflict.
      // While people are editing live, the collaboration document is the
      // source of truth, so the write goes into it and it persists itself.
      // With no room open, the merge goes through the stored CRDT state (so
      // deletions are tombstones), one save at a time (diagramContents.ts)
      const { elements, baseVersions, deletedIds, ...metadata } = parsed.data;
      const write = { elements: (elements ?? []) as ElementJSON[], baseVersions, deletedIds };
      let conflicts: string[] = [];
      if (elements && baseVersions) {
        const merged = await changeDiagramElements(
          app.hocuspocus,
          id,
          (doc) => mergeElements(doc, write).conflicts,
        );
        if (!merged) return reply.code(404).send({ error: 'Diagram not found' });
        conflicts = merged.result;
      } else if (elements) {
        // Legacy whole-diagram replace (API clients without base versions);
        // into a live room it's a merge, like any other edit
        if (!(await replaceStoredElements(app.hocuspocus, id, elements))) {
          const merged = await changeDiagramElements(app.hocuspocus, id, (doc) =>
            mergeElements(doc, write),
          );
          if (!merged) return reply.code(404).send({ error: 'Diagram not found' });
          conflicts = merged.result.conflicts;
        }
      }
      const diagram = await updateDiagram(id, metadata);
      if (!diagram) {
        return reply.code(404).send({ error: 'Diagram not found' });
      }

      return reply.code(200).send({
        diagram: currentDiagram(app.hocuspocus.documents, diagram),
        conflicts,
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

    // Without its top-level diagram a project can't be opened (and the
    // diagram's version history goes with it): delete the project instead
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, existing.projectId),
      columns: { rootDiagramId: true },
    });
    if (project?.rootDiagramId === id) {
      return reply.code(409).send({ error: "A project's top-level diagram can't be deleted" });
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

    const live = await openRoom(app.hocuspocus, id);
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
  // One version's full contents (to preview or compare with now)
  app.get(
    '/api/diagrams/:id/snapshots/:snapshotId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id, snapshotId } = request.params as { id: string; snapshotId: string };
      const existing = await getDiagram(id);
      if (!existing) return reply.code(404).send({ error: 'Diagram not found' });
      if (!(await checkProjectAccess(existing.projectId, request.user!.userId))) {
        return reply.code(403).send({ error: 'Access denied' });
      }
      const snapshot = await getSnapshot(snapshotId);
      if (!snapshot || snapshot.diagramId !== id) {
        return reply.code(404).send({ error: 'Snapshot not found' });
      }
      return reply.send({
        snapshot: {
          id: snapshot.id,
          diagramId: snapshot.diagramId,
          version: snapshot.version,
          label: snapshot.label,
          trigger: snapshot.trigger,
          createdBy: snapshot.createdBy,
          createdAt: snapshot.createdAt.toISOString(),
          elements: snapshot.elements,
          appState: snapshot.appState,
        },
      });
    },
  );

  app.get('/api/diagrams/:id/snapshots', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;
    const page = snapshotPageSchema.safeParse(request.query ?? {});
    if (!page.success) {
      return reply.code(400).send({ error: 'Validation failed', details: page.error.issues });
    }

    const existing = await getDiagram(id);
    if (!existing) {
      return reply.code(404).send({ error: 'Diagram not found' });
    }

    const access = await checkProjectAccess(existing.projectId, userId);
    if (!access) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const snapshotList = await getSnapshots(id, page.data.limit, page.data.offset);
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

      const open = await openRoom(app.hocuspocus, id);

      // Create a new snapshot of current state before restoring
      // Kept as a named version (automatic ones get pruned) so a restore can
      // always be undone
      await createSnapshot(
        id,
        userId,
        'manual',
        `Before restoring “${snapshot.label ?? `version ${snapshot.version}`}”`,
        open ? readLiveElements(open) : undefined,
      );

      // Restore the diagram from the snapshot
      const appState = snapshot.appState as Record<string, unknown>;
      const metadata = {
        viewBackgroundColor: appState.viewBackgroundColor as string | undefined,
        gridEnabled: appState.gridEnabled as boolean | undefined,
        gridSize: appState.gridSize as number | undefined,
        renderMode: appState.renderMode as string | undefined,
        layers: appState.layers as unknown[] | undefined,
      };
      // In the live room everyone connected sees it at once. Otherwise it goes
      // through the stored CRDT state: what the version doesn't have is
      // deleted there, so a tab with an older copy can't bring it back.
      const restored = await changeDiagramElements(app.hocuspocus, id, (doc) =>
        replaceElements(doc, snapshot.elements as ElementJSON[]),
      );
      if (!restored) return reply.code(404).send({ error: 'Diagram not found' });
      const diagram = await updateDiagram(id, metadata);

      // Create a post-restore snapshot
      await createSnapshot(
        id,
        userId,
        'auto',
        'Restored from version ' + snapshot.version,
        restored.live ? readLiveElements(restored.live) : undefined,
      );

      return reply.code(200).send({
        diagram: publicDiagram(diagram!),
      });
    },
  );
}

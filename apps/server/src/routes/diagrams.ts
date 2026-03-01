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

const createDiagramSchema = z.object({
  projectId: z.string().min(1),
  parentDiagramId: z.string().nullable().optional(),
  parentPortalId: z.string().nullable().optional(),
  title: z.string().min(1).max(255).optional(),
});

const updateDiagramSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  elements: z.array(z.any()).optional(),
  viewBackgroundColor: z.string().optional(),
  gridEnabled: z.boolean().optional(),
  gridSize: z.number().int().positive().optional(),
  renderMode: z.enum(['sketchy', 'clean']).optional(),
  layers: z.array(z.any()).optional(),
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

    const diagram = await createDiagram({
      projectId: parsed.data.projectId,
      parentDiagramId: parsed.data.parentDiagramId,
      parentPortalId: parsed.data.parentPortalId,
      title: parsed.data.title,
      userId,
    });

    return reply.code(201).send({
      diagram: {
        ...diagram,
        createdAt: diagram.createdAt.toISOString(),
        updatedAt: diagram.updatedAt.toISOString(),
      },
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
      diagram: {
        ...diagram,
        createdAt: diagram.createdAt.toISOString(),
        updatedAt: diagram.updatedAt.toISOString(),
      },
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
        diagrams: diagramList.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        })),
      });
    },
  );

  // Update diagram
  app.put('/api/diagrams/:id', { preHandler: [requireAuth] }, async (request, reply) => {
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

    const diagram = await updateDiagram(id, parsed.data);
    if (!diagram) {
      return reply.code(404).send({ error: 'Diagram not found' });
    }

    return reply.code(200).send({
      diagram: {
        ...diagram,
        createdAt: diagram.createdAt.toISOString(),
        updatedAt: diagram.updatedAt.toISOString(),
      },
    });
  });

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
  app.post(
    '/api/diagrams/:id/save',
    { preHandler: [requireAuth] },
    async (request, reply) => {
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

      const snapshot = await createSnapshot(
        id,
        userId,
        parsed.data.trigger ?? 'manual',
        parsed.data.label,
      );

      return reply.code(201).send({
        snapshot: {
          ...snapshot,
          createdAt: snapshot.createdAt.toISOString(),
        },
      });
    },
  );

  // Get snapshots for a diagram
  app.get(
    '/api/diagrams/:id/snapshots',
    { preHandler: [requireAuth] },
    async (request, reply) => {
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
      return reply.code(200).send({
        snapshots: snapshotList.map((s) => ({
          ...s,
          createdAt: s.createdAt.toISOString(),
        })),
      });
    },
  );

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

      // Create a new snapshot of current state before restoring
      await createSnapshot(id, userId, 'auto', 'Pre-restore backup');

      // Restore the diagram from the snapshot
      const appState = snapshot.appState as Record<string, unknown>;
      const diagram = await updateDiagram(id, {
        elements: snapshot.elements as unknown[],
        viewBackgroundColor: appState.viewBackgroundColor as string | undefined,
        gridEnabled: appState.gridEnabled as boolean | undefined,
        gridSize: appState.gridSize as number | undefined,
        renderMode: appState.renderMode as string | undefined,
        layers: appState.layers as unknown[] | undefined,
      });

      // Create a post-restore snapshot
      await createSnapshot(id, userId, 'auto', 'Restored from version ' + snapshot.version);

      return reply.code(200).send({
        diagram: {
          ...diagram,
          createdAt: diagram!.createdAt.toISOString(),
          updatedAt: diagram!.updatedAt.toISOString(),
        },
      });
    },
  );
}

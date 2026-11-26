import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { projectTours, users } from '../db/schema.js';
import { checkProjectAccess, getDiagramSummaries } from '../services/diagramService.js';
import { requireAuth } from '../middleware/auth.js';
import { signalDocument } from '../ws/hocuspocus.js';

const stopSchema = z.object({
  id: z.string().min(1).max(64),
  diagramId: z.string().min(1).max(64),
  viewport: z
    .object({
      zoom: z.number().positive().finite(),
      scrollX: z.number().finite(),
      scrollY: z.number().finite(),
    })
    .nullable(),
  title: z.string().max(200),
  note: z.string().max(2000),
});
const tourSchema = z.object({ stops: z.array(stopSchema).max(100) });
const presentSchema = z.object({ stop: z.number().int().min(0).max(99).nullable() });

/** Who is presenting what, per project. Ephemeral by nature: kept in memory. */
interface Presentation {
  presenterId: string;
  presenterName: string;
  stop: number;
  updatedAt: number;
}
const presentations = new Map<string, Presentation>();
/** A presentation nobody has advanced for this long is over. */
const PRESENTATION_TTL_MS = 30 * 60 * 1000;

export function currentPresentation(projectId: string, now = Date.now()): Presentation | null {
  const p = presentations.get(projectId);
  if (!p) return null;
  if (now - p.updatedAt > PRESENTATION_TTL_MS) {
    presentations.delete(projectId);
    return null;
  }
  return p;
}

export async function tourRoutes(app: FastifyInstance): Promise<void> {
  /** Every open room of the project hears about it (followers may be on any level). */
  const signal = async (projectId: string, key: string) => {
    for (const d of await getDiagramSummaries(projectId)) signalDocument(app.hocuspocus, d.id, key);
  };

  app.get('/api/projects/:id/tour', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await checkProjectAccess(id, request.user!.userId))) {
      return reply.code(403).send({ error: 'Access denied' });
    }
    const row = await db.query.projectTours.findFirst({ where: eq(projectTours.projectId, id) });
    return reply.send({ stops: row?.stops ?? [], updatedAt: row?.updatedAt.toISOString() ?? null });
  });

  app.put('/api/projects/:id/tour', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;
    const access = await checkProjectAccess(id, userId);
    if (!access || access === 'viewer') return reply.code(403).send({ error: 'Access denied' });
    const parsed = tourSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    // Stops must point at this project's diagrams
    const ids = new Set((await getDiagramSummaries(id)).map((d) => d.id));
    const stops = parsed.data.stops.filter((s) => ids.has(s.diagramId));
    const now = new Date();
    await db
      .insert(projectTours)
      .values({ projectId: id, stops, updatedBy: userId, updatedAt: now })
      .onConflictDoUpdate({
        target: projectTours.projectId,
        set: { stops, updatedBy: userId, updatedAt: now },
      });
    void signal(id, 'tour');
    return reply.send({ stops, updatedAt: now.toISOString() });
  });

  app.get(
    '/api/projects/:id/presentation',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!(await checkProjectAccess(id, request.user!.userId))) {
        return reply.code(403).send({ error: 'Access denied' });
      }
      return reply.send({ presentation: currentPresentation(id) });
    },
  );

  // Start / advance / end presenting (anyone who can open the project may present)
  app.put(
    '/api/projects/:id/presentation',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;
      if (!(await checkProjectAccess(id, userId)))
        return reply.code(403).send({ error: 'Access denied' });
      const parsed = presentSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }
      const existing = currentPresentation(id);
      if (parsed.data.stop === null) {
        if (existing?.presenterId === userId) presentations.delete(id);
      } else {
        const me = await db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { name: true },
        });
        // Taking over is allowed: the latest presenter leads
        presentations.set(id, {
          presenterId: userId,
          presenterName: me?.name ?? 'Someone',
          stop: parsed.data.stop,
          updatedAt: Date.now(),
        });
      }
      void signal(id, 'presentation');
      return reply.send({ presentation: currentPresentation(id) });
    },
  );
}

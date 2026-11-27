import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { MODEL_COMPONENT_KINDS, componentById } from '@mavisdraw/llm';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { projects } from '../db/schema.js';
import { checkProjectAccess, getDiagramIds } from '../services/diagramService.js';
import {
  createModelComponent,
  deleteComponentDetails,
  deleteRelationship,
  getProjectModel,
  ModelError,
  renameComponent,
  saveComponentDetails,
  saveRelationship,
} from '../services/modelService.js';
import { signalDocument } from '../ws/hocuspocus.js';

const kind = z.enum(MODEL_COMPONENT_KINDS as [string, ...string[]]);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const details = {
  kind: kind.optional(),
  description: optionalText(2000),
  technology: optionalText(255),
  owner: optionalText(255),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  links: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(100),
        url: z
          .string()
          .trim()
          .max(2000)
          .url()
          .refine((u) => /^https?:\/\//i.test(u), 'Links must be http(s)'),
      }),
    )
    .max(10)
    .optional(),
};
const componentUpdate = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  ...details,
});
const componentCreate = z.object({ name: z.string().trim().min(1).max(255), ...details });
const relationshipInput = z.object({
  sourceId: z.string().min(1).max(64),
  targetId: z.string().min(1).max(64),
  description: optionalText(2000),
  technology: optionalText(255),
});

/**
 * The project's architecture model: read by anyone on the project; changed
 * (details, renames, recorded relationships) by people who can edit the map.
 */
export async function modelRoutes(app: FastifyInstance): Promise<void> {
  const signal = (projectId: string, keys: string[]) => {
    void getDiagramIds(projectId)
      .then((list) => {
        for (const d of list) for (const key of keys) signalDocument(app.hocuspocus, d.id, key);
      })
      .catch((err) => app.log.error(err, 'Failed to signal model change'));
  };

  /** The project, if this person may read (or, with `write`, change) its model. */
  const projectFor = async (
    projectId: string,
    userId: string,
    reply: FastifyReply,
    write: boolean,
  ) => {
    const access = await checkProjectAccess(projectId, userId);
    if (!access || (write && access === 'viewer')) {
      void reply.code(403).send({ error: 'Access denied' });
      return null;
    }
    const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!project) {
      void reply.code(404).send({ error: 'Project not found' });
      return null;
    }
    return project;
  };

  const modelOf = (project: NonNullable<Awaited<ReturnType<typeof projectFor>>>) =>
    getProjectModel(project, app.hocuspocus.documents);

  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof ModelError) return reply.code(err.status).send({ error: err.message });
    throw err;
  };

  app.get('/api/projects/:id/model', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await projectFor(id, request.user!.userId, reply, false);
    if (!project) return reply;
    return reply.send({ model: await modelOf(project) });
  });

  // A component nobody has drawn yet (recorded by a person or an agent)
  app.post(
    '/api/projects/:id/model/components',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = componentCreate.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid component', details: parsed.error.issues });
      }
      const project = await projectFor(id, request.user!.userId, reply, true);
      if (!project) return reply;
      const componentId = await createModelComponent(
        id,
        parsed.data as Parameters<typeof createModelComponent>[1],
        request.user!.userId,
      );
      signal(id, ['model']);
      return reply
        .code(201)
        .send({ component: componentById(await modelOf(project), componentId) });
    },
  );

  // Details, and renaming (which relabels every appearance)
  app.put(
    '/api/projects/:id/model/components/:componentId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id, componentId } = request.params as { id: string; componentId: string };
      const parsed = componentUpdate.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid component', details: parsed.error.issues });
      }
      const project = await projectFor(id, request.user!.userId, reply, true);
      if (!project) return reply;
      const current = componentById(await modelOf(project), componentId);
      if (!current) return reply.code(404).send({ error: 'Component not found' });

      const { name, ...rest } = parsed.data;
      const renamed = name !== undefined && name !== current.name;
      if (renamed) {
        await renameComponent(project, componentId, name, app.hocuspocus, request.user!.userId);
      }
      if (Object.keys(rest).length > 0 || (renamed && current.stored)) {
        await saveComponentDetails(
          id,
          componentId,
          { ...(rest as Parameters<typeof saveComponentDetails>[2]), name: name ?? current.name },
          request.user!.userId,
        );
      }
      signal(id, renamed ? ['model', 'diagrams'] : ['model']);
      return reply.send({ component: componentById(await modelOf(project), componentId) });
    },
  );

  app.delete(
    '/api/projects/:id/model/components/:componentId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id, componentId } = request.params as { id: string; componentId: string };
      const project = await projectFor(id, request.user!.userId, reply, true);
      if (!project) return reply;
      await deleteComponentDetails(id, componentId);
      signal(id, ['model']);
      return reply.code(204).send();
    },
  );

  // Record what an arrow can't say, or a dependency nobody has drawn
  app.put(
    '/api/projects/:id/model/relationships',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = relationshipInput.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid relationship', details: parsed.error.issues });
      }
      const project = await projectFor(id, request.user!.userId, reply, true);
      if (!project) return reply;
      const model = await modelOf(project);
      for (const end of [parsed.data.sourceId, parsed.data.targetId]) {
        if (!componentById(model, end)) {
          return reply.code(404).send({ error: `Component ${end} not found` });
        }
      }
      try {
        await saveRelationship(id, parsed.data, request.user!.userId);
      } catch (err) {
        return fail(reply, err);
      }
      signal(id, ['model']);
      const after = await modelOf(project);
      return reply.send({
        relationship: after.relationships.find(
          (r) => r.sourceId === parsed.data.sourceId && r.targetId === parsed.data.targetId,
        ),
      });
    },
  );

  app.delete(
    '/api/projects/:id/model/relationships',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = z
        .object({ source: z.string().min(1).max(64), target: z.string().min(1).max(64) })
        .safeParse(request.query ?? {});
      if (!query.success) return reply.code(400).send({ error: 'Give source and target' });
      const project = await projectFor(id, request.user!.userId, reply, true);
      if (!project) return reply;
      await deleteRelationship(id, query.data.source, query.data.target);
      signal(id, ['model']);
      return reply.code(204).send();
    },
  );
}

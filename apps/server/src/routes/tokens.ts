import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import {
  createToken,
  listTokens,
  revokeToken,
  MAX_TOKEN_PROJECTS,
  TooManyTokensError,
} from '../services/apiTokenService.js';
import { listAccessibleProjects } from '../services/projectService.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  /** Read only, or read and propose updates (the default) */
  access: z.enum(['read', 'propose']).default('propose'),
  /** Limit it to these projects; null or absent for all of the person's */
  projectIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_TOKEN_PROJECTS).nullish(),
});

/** Access tokens for coding agents, managed by their owner. */
export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/tokens', { preHandler: [requireAuth] }, async (request, reply) => {
    return reply.send({ tokens: await listTokens(request.user!.userId) });
  });

  app.post('/api/tokens', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Give the token a name' });
    const userId = request.user!.userId;
    const projectIds = parsed.data.projectIds ? [...new Set(parsed.data.projectIds)] : null;
    if (projectIds) {
      const mine = new Set((await listAccessibleProjects(userId)).map((p) => p.id));
      if (projectIds.some((id) => !mine.has(id))) {
        return reply.code(400).send({ error: "Some of those projects aren't yours to share" });
      }
    }
    try {
      const { token, summary } = await createToken(userId, parsed.data.name, {
        access: parsed.data.access,
        projectIds,
      });
      return reply.code(201).send({ token, summary });
    } catch (err) {
      if (err instanceof TooManyTokensError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  app.delete('/api/tokens/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await revokeToken(request.user!.userId, id))) {
      return reply.code(404).send({ error: 'Token not found' });
    }
    return reply.code(204).send();
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import {
  createToken,
  listTokens,
  revokeToken,
  TooManyTokensError,
} from '../services/apiTokenService.js';

const createSchema = z.object({ name: z.string().trim().min(1).max(100) });

/** Access tokens for coding agents, managed by their owner. */
export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/tokens', { preHandler: [requireAuth] }, async (request, reply) => {
    return reply.send({ tokens: await listTokens(request.user!.userId) });
  });

  app.post('/api/tokens', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Give the token a name' });
    try {
      const { token, summary } = await createToken(request.user!.userId, parsed.data.name);
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

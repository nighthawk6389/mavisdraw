import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { checkProjectAccess, getDiagramIds } from '../services/diagramService.js';
import { getProposal, listPendingProposals, resolveProposal } from '../services/proposalService.js';
import { signalDocument } from '../ws/hocuspocus.js';

const resolveSchema = z.object({ status: z.enum(['applied', 'dismissed', 'pending']) });

/**
 * Proposed map updates (from coding agents): everyone on the project sees
 * them; applying or dismissing needs edit access, like editing the map.
 */
export async function proposalRoutes(app: FastifyInstance): Promise<void> {
  const signal = (projectId: string) => {
    void getDiagramIds(projectId)
      .then((list) => {
        for (const d of list) signalDocument(app.hocuspocus, d.id, 'proposals');
      })
      .catch((err) => app.log.error(err, 'Failed to signal proposal change'));
  };

  app.get('/api/projects/:id/proposals', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await checkProjectAccess(id, request.user!.userId))) {
      return reply.code(403).send({ error: 'Access denied' });
    }
    return reply.send({ proposals: await listPendingProposals(id) });
  });

  app.post('/api/proposals/:id/resolve', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = resolveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid status' });
    const proposal = await getProposal(id);
    if (!proposal) return reply.code(404).send({ error: 'Proposal not found' });
    const access = await checkProjectAccess(proposal.projectId, request.user!.userId);
    if (!access) return reply.code(403).send({ error: 'Access denied' });
    if (access === 'viewer') {
      return reply
        .code(403)
        .send({ error: 'Only people who can edit the map can apply proposals' });
    }
    if (!(await resolveProposal(id, request.user!.userId, parsed.data.status))) {
      return reply.code(409).send({ error: 'Someone already handled this proposal' });
    }
    signal(proposal.projectId);
    return reply.send({ ok: true });
  });
}

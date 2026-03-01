import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { projects } from '../db/schema.js';
import {
  createShareLink,
  resolveShareToken,
  getProjectPermissions,
  updatePermission,
  revokePermission,
} from '../services/sharingService.js';
import { checkProjectAccess } from '../services/diagramService.js';
import { requireAuth } from '../middleware/auth.js';

const createShareSchema = z.object({
  role: z.enum(['viewer', 'editor']),
});

const updatePermissionSchema = z.object({
  role: z.enum(['viewer', 'editor', 'admin']),
});

export async function sharingRoutes(app: FastifyInstance): Promise<void> {
  // Create share link
  app.post(
    '/api/projects/:id/share',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;

      const parsed = createShareSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }

      const access = await checkProjectAccess(id, userId);
      if (access !== 'owner' && access !== 'admin') {
        return reply.code(403).send({ error: 'Only owner or admin can create share links' });
      }

      const shareLink = await createShareLink(id, parsed.data.role);
      return reply.code(201).send({ share: shareLink });
    },
  );

  // Resolve share token (join via share link)
  app.post('/api/share/:token', { preHandler: [requireAuth] }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const userId = request.user!.userId;

    const result = await resolveShareToken(token, userId);
    if (!result) {
      return reply.code(404).send({ error: 'Invalid share link' });
    }

    return reply.code(200).send(result);
  });

  // List permissions for a project
  app.get(
    '/api/projects/:id/permissions',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;

      const access = await checkProjectAccess(id, userId);
      if (!access) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const permissions = await getProjectPermissions(id);
      return reply.code(200).send({ permissions });
    },
  );

  // Update permission
  app.put(
    '/api/permissions/:permissionId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { permissionId } = request.params as { permissionId: string };
      const userId = request.user!.userId;

      const parsed = updatePermissionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }

      // Get the permission to find the project
      const permissions = await db.query.projectPermissions.findFirst({
        where: eq(db._.fullSchema.projectPermissions.id, permissionId),
      });
      if (!permissions) {
        return reply.code(404).send({ error: 'Permission not found' });
      }

      const access = await checkProjectAccess(permissions.projectId, userId);
      if (access !== 'owner' && access !== 'admin') {
        return reply.code(403).send({ error: 'Only owner or admin can update permissions' });
      }

      const updated = await updatePermission(permissionId, parsed.data.role);
      return reply.code(200).send({
        permission: {
          ...updated,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      });
    },
  );

  // Revoke permission
  app.delete(
    '/api/permissions/:permissionId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { permissionId } = request.params as { permissionId: string };
      const userId = request.user!.userId;

      const permission = await db.query.projectPermissions.findFirst({
        where: eq(db._.fullSchema.projectPermissions.id, permissionId),
      });
      if (!permission) {
        return reply.code(404).send({ error: 'Permission not found' });
      }

      const access = await checkProjectAccess(permission.projectId, userId);
      if (access !== 'owner' && access !== 'admin') {
        return reply.code(403).send({ error: 'Only owner or admin can revoke permissions' });
      }

      await revokePermission(permissionId);
      return reply.code(200).send({ message: 'Permission revoked' });
    },
  );
}

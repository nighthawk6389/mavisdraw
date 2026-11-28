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
import { applyAccessChange } from '../ws/hocuspocus.js';

const createShareSchema = z.object({
  role: z.enum(['viewer', 'editor']),
  /** Days until it stops letting people join; null or left out: never. */
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});

const updatePermissionSchema = z.object({
  role: z.enum(['viewer', 'editor', 'admin']),
});

export async function sharingRoutes(app: FastifyInstance): Promise<void> {
  // Create share link
  app.post('/api/projects/:id/share', { preHandler: [requireAuth] }, async (request, reply) => {
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

    const shareLink = await createShareLink(
      id,
      parsed.data.role,
      parsed.data.expiresInDays ?? null,
    );
    return reply.code(201).send({ share: shareLink });
  });

  // Resolve share token (join via share link)
  app.post('/api/share/:token', { preHandler: [requireAuth] }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const userId = request.user!.userId;

    const result = await resolveShareToken(token, userId);
    if (!result) {
      return reply.code(404).send({ error: 'Invalid share link' });
    }
    if (result === 'expired') {
      return reply.code(410).send({ error: 'It has expired. Ask whoever sent it for a new one.' });
    }
    // What they can do now: a link never lowers what ownership or a workspace
    // gives them. An upgrade (viewer → editor) applies to tabs already open.
    const access = await checkProjectAccess(result.projectId, userId);
    applyAccessChange(app.hocuspocus, result.projectId, userId, access);

    return reply.code(200).send({ projectId: result.projectId, role: access ?? result.role });
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
      // Share links are bearer credentials, and email addresses are personal
      // (anyone signed in can view a public project): only people who manage
      // sharing see them. Everyone else sees who has access, by name.
      const canManage = access === 'owner' || access === 'admin';
      return reply.code(200).send({
        permissions: canManage
          ? permissions
          : permissions
              .filter((p) => p.userId !== null)
              .map((p) => ({
                ...p,
                shareToken: null,
                email: p.userId === userId ? p.email : null,
              })),
      });
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

      // A share link is a bearer credential: it can grant view or edit, never admin
      if (!permissions.userId && parsed.data.role === 'admin') {
        return reply
          .code(400)
          .send({ error: 'Share links can only grant viewer or editor access' });
      }
      // Only the owner hands out admin (as with invites)
      if (parsed.data.role === 'admin' && access !== 'owner') {
        return reply.code(403).send({ error: 'Only the owner can make someone an admin' });
      }

      const updated = await updatePermission(permissionId, parsed.data.role);
      if (permissions.userId) {
        applyAccessChange(
          app.hocuspocus,
          permissions.projectId,
          permissions.userId,
          parsed.data.role,
        );
      }
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
      if (permission.userId) {
        applyAccessChange(app.hocuspocus, permission.projectId, permission.userId, null);
      }
      return reply.code(200).send({ message: 'Permission revoked' });
    },
  );
}

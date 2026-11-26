import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { projectPermissions, projects } from '../db/schema.js';
import { checkProjectAccess } from '../services/diagramService.js';
import {
  WorkspaceError,
  acceptInvite,
  createWorkspace,
  describeInvite,
  getWorkspaceRole,
  inviteByEmail,
  listMembers,
  listPendingInvites,
  listWorkspacesFor,
  projectIdsInWorkspace,
  removeMember,
  revokeInvite,
  setMemberRole,
} from '../services/workspaceService.js';
import { requireAuth } from '../middleware/auth.js';
import { applyAccessChange } from '../ws/hocuspocus.js';

const nameSchema = z.object({ name: z.string().trim().min(1).max(120) });
const workspaceRole = z.enum(['owner', 'admin', 'member']);
const projectRole = z.enum(['viewer', 'editor', 'admin']);
const email = z.string().trim().email().max(255);

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof WorkspaceError) return reply.code(err.status).send({ error: err.message });
  throw err;
}

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  /** Re-evaluate someone's access to every project of a workspace, on open sockets too. */
  const refreshAccess = async (workspaceId: string, userId: string) => {
    for (const projectId of await projectIdsInWorkspace(workspaceId)) {
      applyAccessChange(
        app.hocuspocus,
        projectId,
        userId,
        await checkProjectAccess(projectId, userId),
      );
    }
  };
  const inviteUrl = (token: string) => `/invite/${token}`;

  app.get('/api/workspaces', { preHandler: [requireAuth] }, async (request, reply) => {
    return reply.send({ workspaces: await listWorkspacesFor(request.user!.userId) });
  });

  app.post('/api/workspaces', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = nameSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Give the workspace a name' });
    return reply
      .code(201)
      .send({ workspace: await createWorkspace(parsed.data.name, request.user!.userId) });
  });

  app.get('/api/workspaces/:id/members', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const role = await getWorkspaceRole(id, request.user!.userId);
    if (!role) return reply.code(404).send({ error: 'Workspace not found' });
    const canManage = role !== 'member';
    return reply.send({
      role,
      members: await listMembers(id),
      // Invite links are credentials for whoever holds them: managers only
      invites: canManage ? await listPendingInvites('workspace', id) : [],
    });
  });

  app.patch(
    '/api/workspaces/:id/members/:userId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const parsed = z.object({ role: workspaceRole }).safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid role' });
      const myRole = await getWorkspaceRole(id, request.user!.userId);
      if (myRole !== 'owner' && myRole !== 'admin')
        return reply.code(403).send({ error: 'Access denied' });
      // Only owners make (or unmake) owners
      const theirs = await getWorkspaceRole(id, userId);
      if ((parsed.data.role === 'owner' || theirs === 'owner') && myRole !== 'owner') {
        return reply.code(403).send({ error: 'Only an owner can change owners' });
      }
      try {
        await setMemberRole(id, userId, parsed.data.role);
      } catch (err) {
        return fail(reply, err);
      }
      await refreshAccess(id, userId);
      return reply.send({ members: await listMembers(id) });
    },
  );

  app.delete(
    '/api/workspaces/:id/members/:userId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const me = request.user!.userId;
      const myRole = await getWorkspaceRole(id, me);
      const leaving = userId === me;
      if (!myRole || (!leaving && myRole === 'member'))
        return reply.code(403).send({ error: 'Access denied' });
      if (!leaving && (await getWorkspaceRole(id, userId)) === 'owner' && myRole !== 'owner') {
        return reply.code(403).send({ error: 'Only an owner can remove an owner' });
      }
      try {
        await removeMember(id, userId);
      } catch (err) {
        return fail(reply, err);
      }
      await refreshAccess(id, userId);
      return reply.code(204).send();
    },
  );

  app.post('/api/workspaces/:id/invites', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ email, role: workspaceRole.exclude(['owner']).default('member') })
      .safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a valid email address' });
    const myRole = await getWorkspaceRole(id, request.user!.userId);
    if (myRole !== 'owner' && myRole !== 'admin')
      return reply.code(403).send({ error: 'Access denied' });
    const result = await inviteByEmail({
      kind: 'workspace',
      targetId: id,
      email: parsed.data.email,
      role: parsed.data.role,
      invitedBy: request.user!.userId,
    });
    if (result.status === 'added') await refreshAccess(id, result.userId);
    return reply
      .code(201)
      .send(
        result.status === 'added'
          ? { status: 'added', emailed: result.emailed }
          : { status: 'invited', inviteUrl: inviteUrl(result.token), emailed: result.emailed },
      );
  });

  app.delete(
    '/api/workspaces/:id/invites/:inviteId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id, inviteId } = request.params as { id: string; inviteId: string };
      const myRole = await getWorkspaceRole(id, request.user!.userId);
      if (myRole !== 'owner' && myRole !== 'admin')
        return reply.code(403).send({ error: 'Access denied' });
      await revokeInvite(inviteId, 'workspace', id);
      return reply.code(204).send();
    },
  );

  // ── Project invites & ownership ───────────────────────────

  app.get('/api/projects/:id/invites', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await checkProjectAccess(id, request.user!.userId);
    if (access !== 'owner' && access !== 'admin')
      return reply.code(403).send({ error: 'Access denied' });
    return reply.send({ invites: await listPendingInvites('project', id) });
  });

  app.post('/api/projects/:id/invites', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ email, role: projectRole.default('editor') })
      .safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a valid email address' });
    const access = await checkProjectAccess(id, request.user!.userId);
    if (access !== 'owner' && access !== 'admin')
      return reply.code(403).send({ error: 'Access denied' });
    // Only the owner hands out admin
    if (parsed.data.role === 'admin' && access !== 'owner') {
      return reply.code(403).send({ error: 'Only the owner can invite admins' });
    }
    const result = await inviteByEmail({
      kind: 'project',
      targetId: id,
      email: parsed.data.email,
      role: parsed.data.role,
      invitedBy: request.user!.userId,
    });
    if (result.status === 'added') {
      applyAccessChange(
        app.hocuspocus,
        id,
        result.userId,
        await checkProjectAccess(id, result.userId),
      );
    }
    return reply
      .code(201)
      .send(
        result.status === 'added'
          ? { status: 'added', emailed: result.emailed }
          : { status: 'invited', inviteUrl: inviteUrl(result.token), emailed: result.emailed },
      );
  });

  app.delete(
    '/api/projects/:id/invites/:inviteId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id, inviteId } = request.params as { id: string; inviteId: string };
      const access = await checkProjectAccess(id, request.user!.userId);
      if (access !== 'owner' && access !== 'admin')
        return reply.code(403).send({ error: 'Access denied' });
      await revokeInvite(inviteId, 'project', id);
      return reply.code(204).send();
    },
  );

  app.post('/api/projects/:id/transfer', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = request.user!.userId;
    const parsed = z.object({ userId: z.string().min(1) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Choose who to transfer to' });
    const project = await db.query.projects.findFirst({ where: eq(projects.id, id) });
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    if (project.ownerId !== me)
      return reply.code(403).send({ error: 'Only the owner can transfer a project' });
    const target = parsed.data.userId;
    if (target === me) return reply.code(400).send({ error: 'You already own this project' });
    if (!(await checkProjectAccess(id, target))) {
      return reply.code(400).send({ error: 'Share the project with them first' });
    }
    const now = new Date();
    await db.update(projects).set({ ownerId: target, updatedAt: now }).where(eq(projects.id, id));
    // The new owner doesn't need a share; the old owner stays on as admin
    await db
      .delete(projectPermissions)
      .where(and(eq(projectPermissions.projectId, id), eq(projectPermissions.userId, target)));
    await db.insert(projectPermissions).values({
      id: nanoid(),
      projectId: id,
      userId: me,
      role: 'admin',
      createdAt: now,
      updatedAt: now,
    });
    applyAccessChange(app.hocuspocus, id, me, 'admin');
    applyAccessChange(app.hocuspocus, id, target, 'owner');
    return reply.send({ ok: true });
  });

  // ── Accepting an invite link ──────────────────────────────

  // Public: lets the invite page say what it's for before signing in
  app.get('/api/invites/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const found = await describeInvite(token);
    if (!found) return reply.code(404).send({ error: 'This invite link is not valid' });
    const { view } = found;
    // Don't reveal the whole address to whoever holds the link
    const [local, domain] = view.email.split('@');
    return reply.send({
      invite: { ...view, email: `${local.slice(0, 2)}…@${domain}` },
    });
  });

  app.post('/api/invites/:token/accept', { preHandler: [requireAuth] }, async (request, reply) => {
    const { token } = request.params as { token: string };
    try {
      const result = await acceptInvite(token, request.user!.userId, request.user!.email);
      if (result.kind === 'project') {
        applyAccessChange(
          app.hocuspocus,
          result.targetId,
          request.user!.userId,
          await checkProjectAccess(result.targetId, request.user!.userId),
        );
      }
      return reply.send(result);
    } catch (err) {
      return fail(reply, err);
    }
  });
}

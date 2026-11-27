import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { projects } from '../db/schema.js';
import { checkProjectAccess, createDiagram } from '../services/diagramService.js';
import { getWorkspaceRole } from '../services/workspaceService.js';
import { listAccessibleProjects } from '../services/projectService.js';
import { getDecryptedToken, GitHubError, repoAccess } from '../services/githubService.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  /** Create it in a team workspace (you must be a member). */
  workspaceId: z.string().min(1).max(64).nullable().optional(),
});

const repoSourceSchema = z
  .object({
    kind: z.enum(['github', 'folder']),
    label: z.string().min(1).max(300),
    owner: z.string().max(100).optional(),
    repo: z.string().max(100).optional(),
    ref: z.string().max(200).optional(),
    connectionId: z.string().max(64).optional(),
    // The architecture model; bounded so a project row stays small
    model: z
      .object({
        name: z.string().max(200),
        components: z.array(z.record(z.string(), z.unknown())).max(500),
        resources: z.array(z.record(z.string(), z.unknown())).max(200),
      })
      .passthrough(),
  })
  .nullable();

const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  isPublic: z.boolean().optional(),
  /** Dashboard folder; null or '' takes it out of any folder. */
  folder: z.string().trim().max(100).nullable().optional(),
  /** Move into a workspace (null: back to the owner's personal space). */
  workspaceId: z.string().min(1).max(64).nullable().optional(),
});

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  // Create project
  app.post('/api/projects', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    const userId = request.user!.userId;
    const projectId = nanoid();
    const now = new Date();
    const workspaceId = parsed.data.workspaceId ?? null;
    if (workspaceId && !(await getWorkspaceRole(workspaceId, userId))) {
      return reply.code(403).send({ error: 'You are not a member of that workspace' });
    }

    // Create project
    const [project] = await db
      .insert(projects)
      .values({
        id: projectId,
        name: parsed.data.name,
        ownerId: userId,
        workspaceId,
        isPublic: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Create root diagram
    const rootDiagram = await createDiagram({
      projectId,
      title: 'Root Diagram',
      userId,
    });

    // Update project with root diagram ID
    const [updatedProject] = await db
      .update(projects)
      .set({ rootDiagramId: rootDiagram.id })
      .where(eq(projects.id, projectId))
      .returning();

    return reply.code(201).send({
      project: {
        ...updatedProject,
        createdAt: updatedProject.createdAt.toISOString(),
        updatedAt: updatedProject.updatedAt.toISOString(),
      },
      rootDiagram: {
        ...rootDiagram,
        createdAt: rootDiagram.createdAt.toISOString(),
        updatedAt: rootDiagram.updatedAt.toISOString(),
      },
    });
  });

  // List the user's projects: owned, shared with them, and in their workspaces
  app.get('/api/projects', { preHandler: [requireAuth] }, async (request, reply) => {
    const list = await listAccessibleProjects(request.user!.userId);
    return reply.code(200).send({
      projects: list.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  });

  // Get single project
  app.get('/api/projects/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, id),
    });

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // Check access (shares, workspace membership, public), and tell the
    // client what it may do
    const role = await checkProjectAccess(id, userId);
    if (!role) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    return reply.code(200).send({
      project: {
        ...project,
        role,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      },
    });
  });

  // Update project
  app.put('/api/projects/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;

    const parsed = updateProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, id),
    });

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    const { folder, workspaceId, ...ownerFields } = parsed.data;
    const isOwner = project.ownerId === userId;
    if ((Object.keys(ownerFields).length > 0 || workspaceId !== undefined) && !isOwner) {
      return reply.code(403).send({ error: 'Only the owner can update this project' });
    }
    if (folder !== undefined) {
      const access = await checkProjectAccess(id, userId);
      if (!access || access === 'viewer') return reply.code(403).send({ error: 'Access denied' });
    }
    if (workspaceId && !(await getWorkspaceRole(workspaceId, userId))) {
      return reply.code(403).send({ error: 'You are not a member of that workspace' });
    }

    const [updated] = await db
      .update(projects)
      .set({
        ...ownerFields,
        ...(folder !== undefined ? { folder: folder ? folder : null } : {}),
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();

    return reply.code(200).send({
      project: {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  });

  // Link the map to the repository it was generated from (editors+; pull
  // request checks need an owner/admin with push access)
  app.put('/api/projects/:id/repo', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;
    const parsed = repoSourceSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const access = await checkProjectAccess(id, userId);
    if (!access || access === 'viewer') return reply.code(403).send({ error: 'Access denied' });
    // What makes a GitHub link feed pull-request checks (see docs/pr-checks.md)
    let prChecks: { host: string; verifiedAt: string } | undefined;
    if (parsed.data?.kind === 'github') {
      // The linker must see the repository through their own GitHub connection
      const { owner, repo, connectionId } = parsed.data;
      if (!owner || !repo || !connectionId) {
        return reply
          .code(400)
          .send({ error: 'A GitHub link needs the repository and your connection' });
      }
      let token: Awaited<ReturnType<typeof getDecryptedToken>>;
      try {
        token = await getDecryptedToken(connectionId, userId);
      } catch (err) {
        if (err instanceof GitHubError) return reply.code(403).send({ error: err.message });
        throw err;
      }
      const repoRights = await repoAccess(token.accessToken, owner, repo, token.enterpriseUrl);
      if (!repoRights) {
        return reply.code(403).send({ error: `Your GitHub connection can't see ${owner}/${repo}` });
      }
      // Pull requests are only checked against maps linked by someone who
      // speaks for both sides: a project owner/admin with push access to the
      // repository. Anyone can read a public repository; that alone must not
      // put their map's text into its pull requests.
      if ((access === 'owner' || access === 'admin') && repoRights.push) {
        prChecks = {
          host: token.enterpriseUrl ?? config.github.cloud.url,
          verifiedAt: new Date().toISOString(),
        };
      }
    }
    const repoSource = parsed.data
      ? {
          ...parsed.data,
          ...(prChecks ?? {}),
          generatedAt: new Date().toISOString(),
          generatedBy: userId,
        }
      : null;
    await db.update(projects).set({ repoSource, updatedAt: new Date() }).where(eq(projects.id, id));
    return reply.send({ repoSource });
  });

  // Delete project
  app.delete('/api/projects/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, id),
    });

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    if (project.ownerId !== userId) {
      return reply.code(403).send({ error: 'Only the owner can delete this project' });
    }

    await db.delete(projects).where(eq(projects.id, id));

    return reply.code(200).send({ message: 'Project deleted' });
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { eq, or, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { projects, projectPermissions } from '../db/schema.js';
import { createDiagram } from '../services/diagramService.js';
import { requireAuth } from '../middleware/auth.js';

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  isPublic: z.boolean().optional(),
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

    // Create project
    const [project] = await db
      .insert(projects)
      .values({
        id: projectId,
        name: parsed.data.name,
        ownerId: userId,
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

  // List user's projects (owned + shared)
  app.get('/api/projects', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.userId;

    // Get owned projects
    const ownedProjects = await db.query.projects.findMany({
      where: eq(projects.ownerId, userId),
    });

    // Get projects shared with user
    const sharedPermissions = await db.query.projectPermissions.findMany({
      where: eq(projectPermissions.userId, userId),
      with: { project: true },
    });

    const sharedProjects = sharedPermissions
      .filter((p) => p.project)
      .map((p) => ({
        ...p.project!,
        role: p.role,
      }));

    const allProjects = [
      ...ownedProjects.map((p) => ({
        ...p,
        role: 'owner' as const,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
      ...sharedProjects
        .filter((sp) => !ownedProjects.some((op) => op.id === sp.id))
        .map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
    ];

    return reply.code(200).send({ projects: allProjects });
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

    // Check access
    if (project.ownerId !== userId) {
      const permission = await db.query.projectPermissions.findFirst({
        where: and(eq(projectPermissions.projectId, id), eq(projectPermissions.userId, userId)),
      });
      if (!permission && !project.isPublic) {
        return reply.code(403).send({ error: 'Access denied' });
      }
    }

    return reply.code(200).send({
      project: {
        ...project,
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

    if (project.ownerId !== userId) {
      return reply.code(403).send({ error: 'Only the owner can update this project' });
    }

    const [updated] = await db
      .update(projects)
      .set({
        ...parsed.data,
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

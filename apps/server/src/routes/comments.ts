import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  checkProjectAccess,
  getDiagram,
  getDiagramsByProject,
} from '../services/diagramService.js';
import {
  MAX_COMMENT_LENGTH,
  addReply,
  createThread,
  deleteComment,
  deleteThread,
  editComment,
  getCommentRow,
  getProjectMembers,
  getThread,
  getThreadRow,
  listNotifications,
  listProjectThreads,
  markNotificationsRead,
  setResolved,
} from '../services/commentService.js';
import { requireAuth } from '../middleware/auth.js';
import { signalDocument } from '../ws/hocuspocus.js';

const body = z.string().trim().min(1).max(MAX_COMMENT_LENGTH);
const mentions = z.array(z.string().min(1).max(64)).max(50).default([]);
const coord = z.number().finite();

const createThreadSchema = z.object({
  elementId: z.string().min(1).max(64).nullable().default(null),
  x: coord,
  y: coord,
  offsetX: coord.default(0),
  offsetY: coord.default(0),
  body,
  mentions,
});

const replySchema = z.object({ body, mentions });
const resolveSchema = z.object({ resolved: z.boolean() });
const editSchema = z.object({ body, mentions });
const readSchema = z.object({ ids: z.array(z.string()).max(200).optional() });

/**
 * Comments are open to everyone on the project, viewers included: reviewers
 * who can't edit the diagram are exactly the people who need to comment.
 */
export async function commentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Tell everyone with any of the project's diagrams open that its comments
   * changed (the panel and header count cover every level, not just the
   * one a thread is on).
   */
  const signal = (projectId: string) => {
    void getDiagramsByProject(projectId)
      .then((list) => {
        for (const d of list) signalDocument(app.hocuspocus, d.id, 'comments');
      })
      .catch((err) => app.log.error(err, 'Failed to signal comment change'));
  };

  app.get('/api/projects/:id/members', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await checkProjectAccess(id, request.user!.userId))) {
      return reply.code(403).send({ error: 'Access denied' });
    }
    return reply.send({ members: await getProjectMembers(id) });
  });

  app.get('/api/projects/:id/comments', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await checkProjectAccess(id, request.user!.userId))) {
      return reply.code(403).send({ error: 'Access denied' });
    }
    return reply.send({ threads: await listProjectThreads(id) });
  });

  app.post('/api/diagrams/:id/comments', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;
    const parsed = createThreadSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const diagram = await getDiagram(id);
    if (!diagram) return reply.code(404).send({ error: 'Diagram not found' });
    if (!(await checkProjectAccess(diagram.projectId, userId))) {
      return reply.code(403).send({ error: 'Access denied' });
    }
    const thread = await createThread({
      ...parsed.data,
      projectId: diagram.projectId,
      diagramId: id,
      userId,
    });
    signal(diagram.projectId);
    return reply.code(201).send({ thread });
  });

  /** Load a thread and check the caller can see it (404 otherwise, to not leak ids). */
  async function threadFor(threadId: string, userId: string) {
    const thread = await getThreadRow(threadId);
    if (!thread) return null;
    const access = await checkProjectAccess(thread.projectId, userId);
    return access ? { thread, access } : null;
  }

  app.post(
    '/api/comment-threads/:id/replies',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;
      const parsed = replySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }
      const found = await threadFor(id, userId);
      if (!found) return reply.code(404).send({ error: 'Thread not found' });
      const thread = await addReply(id, userId, parsed.data.body, parsed.data.mentions);
      signal(found.thread.projectId);
      return reply.code(201).send({ thread });
    },
  );

  app.patch('/api/comment-threads/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;
    const parsed = resolveSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const found = await threadFor(id, userId);
    if (!found) return reply.code(404).send({ error: 'Thread not found' });
    const thread = await setResolved(id, userId, parsed.data.resolved);
    signal(found.thread.projectId);
    return reply.send({ thread });
  });

  app.delete('/api/comment-threads/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;
    const found = await threadFor(id, userId);
    if (!found) return reply.code(404).send({ error: 'Thread not found' });
    const canModerate = found.access === 'owner' || found.access === 'admin';
    if (found.thread.createdBy !== userId && !canModerate) {
      return reply.code(403).send({ error: 'Only the author or a project admin can delete this' });
    }
    await deleteThread(id);
    signal(found.thread.projectId);
    return reply.code(204).send();
  });

  app.patch('/api/comments/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;
    const parsed = editSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const comment = await getCommentRow(id);
    const found = comment ? await threadFor(comment.threadId, userId) : null;
    if (!comment || !found) return reply.code(404).send({ error: 'Comment not found' });
    if (comment.authorId !== userId) {
      return reply.code(403).send({ error: 'You can only edit your own comments' });
    }
    await editComment(id, found.thread.projectId, parsed.data.body, parsed.data.mentions);
    signal(found.thread.projectId);
    return reply.send({ thread: await getThread(comment.threadId) });
  });

  app.delete('/api/comments/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;
    const comment = await getCommentRow(id);
    const found = comment ? await threadFor(comment.threadId, userId) : null;
    if (!comment || !found) return reply.code(404).send({ error: 'Comment not found' });
    const canModerate = found.access === 'owner' || found.access === 'admin';
    if (comment.authorId !== userId && !canModerate) {
      return reply.code(403).send({ error: 'Only the author or a project admin can delete this' });
    }
    const threadGone = await deleteComment(id, comment.threadId);
    signal(found.thread.projectId);
    return reply.send({ thread: threadGone ? null : await getThread(comment.threadId) });
  });

  app.get('/api/notifications', { preHandler: [requireAuth] }, async (request, reply) => {
    const items = await listNotifications(request.user!.userId);
    return reply.send({
      notifications: items,
      unreadCount: items.filter((n) => !n.readAt).length,
    });
  });

  app.post('/api/notifications/read', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = readSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    await markNotificationsRead(request.user!.userId, parsed.data.ids);
    return reply.code(204).send();
  });
}

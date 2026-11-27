import { nanoid } from 'nanoid';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  commentThreads,
  comments,
  diagrams,
  notifications,
  projectPermissions,
  projects,
  users,
  workspaceMembers,
  type NotificationType,
} from '../db/schema.js';
import { config } from '../config.js';
import { isMailEnabled, mentionEmail, sendMail } from './mailer.js';

export const MAX_COMMENT_LENGTH = 5000;

export interface Member {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** Everyone who can open the project (owner + people it's shared with). */
export async function getProjectMembers(projectId: string): Promise<Member[]> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project) return [];
  const perms = await db.query.projectPermissions.findMany({
    where: eq(projectPermissions.projectId, projectId),
    columns: { userId: true },
  });
  const teammates = project.workspaceId
    ? await db.query.workspaceMembers.findMany({
        where: eq(workspaceMembers.workspaceId, project.workspaceId),
        columns: { userId: true },
      })
    : [];
  const ids = Array.from(
    new Set([
      project.ownerId,
      ...perms.map((p) => p.userId).filter((id): id is string => !!id),
      ...teammates.map((m) => m.userId),
    ]),
  );
  const rows = await db.query.users.findMany({
    where: inArray(users.id, ids),
    columns: { id: true, name: true, avatarUrl: true },
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Who gets notified about a new comment: mentioned project members get a
 * "mention", other people already in the thread get a "reply". The author
 * never notifies themselves, and nobody gets two notifications for one comment.
 */
export function notificationRecipients(input: {
  authorId: string;
  mentions: string[];
  participants: string[];
  memberIds: Set<string>;
}): Array<{ userId: string; type: NotificationType }> {
  const out = new Map<string, NotificationType>();
  for (const id of input.mentions) {
    if (id !== input.authorId && input.memberIds.has(id)) out.set(id, 'mention');
  }
  for (const id of input.participants) {
    if (id !== input.authorId && input.memberIds.has(id) && !out.has(id)) out.set(id, 'reply');
  }
  return Array.from(out, ([userId, type]) => ({ userId, type }));
}

/** Keep only mentions of real project members (and drop duplicates). */
export function validMentions(mentions: string[], memberIds: Set<string>): string[] {
  return Array.from(new Set(mentions.filter((id) => memberIds.has(id))));
}

export interface CommentView {
  id: string;
  threadId: string;
  body: string;
  mentions: string[];
  author: Member;
  createdAt: string;
  editedAt: string | null;
}

export interface ThreadView {
  id: string;
  projectId: string;
  diagramId: string;
  elementId: string | null;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdBy: string;
  createdAt: string;
  comments: CommentView[];
}

async function threadViews(where: ReturnType<typeof eq>): Promise<ThreadView[]> {
  const threads = await db.query.commentThreads.findMany({
    where,
    orderBy: [desc(commentThreads.createdAt)],
  });
  if (threads.length === 0) return [];
  const rows = await db.query.comments.findMany({
    where: inArray(
      comments.threadId,
      threads.map((t) => t.id),
    ),
    orderBy: [comments.createdAt],
  });
  const authorIds = Array.from(new Set(rows.map((c) => c.authorId)));
  const authors = authorIds.length
    ? await db.query.users.findMany({
        where: inArray(users.id, authorIds),
        columns: { id: true, name: true, avatarUrl: true },
      })
    : [];
  const byId = new Map(authors.map((a) => [a.id, a]));
  const byThread = new Map<string, CommentView[]>();
  for (const c of rows) {
    const list = byThread.get(c.threadId) ?? [];
    list.push({
      id: c.id,
      threadId: c.threadId,
      body: c.body,
      mentions: c.mentions ?? [],
      author: byId.get(c.authorId) ?? { id: c.authorId, name: 'Unknown', avatarUrl: null },
      createdAt: c.createdAt.toISOString(),
      editedAt: c.editedAt?.toISOString() ?? null,
    });
    byThread.set(c.threadId, list);
  }
  return threads.map((t) => ({
    id: t.id,
    projectId: t.projectId,
    diagramId: t.diagramId,
    elementId: t.elementId,
    x: t.x,
    y: t.y,
    offsetX: t.offsetX,
    offsetY: t.offsetY,
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    resolvedBy: t.resolvedBy,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    comments: byThread.get(t.id) ?? [],
  }));
}

/** Every thread in a project, across all nested diagrams. */
export function listProjectThreads(projectId: string): Promise<ThreadView[]> {
  return threadViews(eq(commentThreads.projectId, projectId));
}

export async function getThread(threadId: string): Promise<ThreadView | null> {
  const [view] = await threadViews(eq(commentThreads.id, threadId));
  return view ?? null;
}

export async function getThreadRow(threadId: string) {
  return db.query.commentThreads.findFirst({ where: eq(commentThreads.id, threadId) });
}

export async function getCommentRow(commentId: string) {
  return db.query.comments.findFirst({ where: eq(comments.id, commentId) });
}

async function notify(
  thread: { id: string; projectId: string; diagramId: string },
  commentId: string,
  authorId: string,
  mentions: string[],
  memberIds: Set<string>,
): Promise<void> {
  const previous = await db.query.comments.findMany({
    where: eq(comments.threadId, thread.id),
    columns: { authorId: true, mentions: true },
  });
  const participants = Array.from(
    new Set(previous.flatMap((c) => [c.authorId, ...(c.mentions ?? [])])),
  );
  const recipients = notificationRecipients({ authorId, mentions, participants, memberIds });
  if (recipients.length === 0) return;
  // Mentions also go out by email (replies stay in the app: less noise)
  void emailMentions(
    thread,
    commentId,
    authorId,
    recipients.filter((r) => r.type === 'mention').map((r) => r.userId),
  );
  const now = new Date();
  await db.insert(notifications).values(
    recipients.map((r) => ({
      id: nanoid(),
      userId: r.userId,
      type: r.type,
      projectId: thread.projectId,
      diagramId: thread.diagramId,
      threadId: thread.id,
      commentId,
      actorId: authorId,
      createdAt: now,
    })),
  );
}

async function emailMentions(
  thread: { id: string; projectId: string; diagramId: string },
  commentId: string,
  authorId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0 || !isMailEnabled()) return;
  const [people, actor, project, diagram, comment] = await Promise.all([
    db.query.users.findMany({ where: inArray(users.id, userIds), columns: { email: true } }),
    db.query.users.findFirst({ where: eq(users.id, authorId), columns: { name: true } }),
    db.query.projects.findFirst({
      where: eq(projects.id, thread.projectId),
      columns: { name: true },
    }),
    db.query.diagrams.findFirst({
      where: eq(diagrams.id, thread.diagramId),
      columns: { title: true },
    }),
    db.query.comments.findFirst({ where: eq(comments.id, commentId), columns: { body: true } }),
  ]);
  const body = comment?.body ?? '';
  const link = `${config.appUrl}/p/${thread.projectId}/d/${thread.diagramId}?thread=${encodeURIComponent(thread.id)}`;
  for (const person of people) {
    await sendMail(
      mentionEmail({
        to: person.email,
        actorName: actor?.name ?? 'Someone',
        projectName: project?.name ?? 'a project',
        diagramTitle: diagram?.title ?? 'a diagram',
        excerpt: body.length > 280 ? `${body.slice(0, 279)}…` : body,
        link,
      }),
    );
  }
}

export async function createThread(input: {
  projectId: string;
  diagramId: string;
  elementId: string | null;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  body: string;
  mentions: string[];
  userId: string;
}): Promise<ThreadView> {
  const members = await getProjectMembers(input.projectId);
  const memberIds = new Set(members.map((m) => m.id));
  const mentions = validMentions(input.mentions, memberIds);
  const now = new Date();
  const threadId = nanoid();
  const commentId = nanoid();
  await db.insert(commentThreads).values({
    id: threadId,
    projectId: input.projectId,
    diagramId: input.diagramId,
    elementId: input.elementId,
    x: input.x,
    y: input.y,
    offsetX: input.offsetX,
    offsetY: input.offsetY,
    createdBy: input.userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(comments).values({
    id: commentId,
    threadId,
    authorId: input.userId,
    body: input.body,
    mentions,
    createdAt: now,
  });
  await notify(
    { id: threadId, projectId: input.projectId, diagramId: input.diagramId },
    commentId,
    input.userId,
    mentions,
    memberIds,
  );
  return (await getThread(threadId))!;
}

export async function addReply(
  threadId: string,
  userId: string,
  body: string,
  rawMentions: string[],
): Promise<ThreadView> {
  const thread = (await getThreadRow(threadId))!;
  const members = await getProjectMembers(thread.projectId);
  const memberIds = new Set(members.map((m) => m.id));
  const mentions = validMentions(rawMentions, memberIds);
  const commentId = nanoid();
  const now = new Date();
  await db.insert(comments).values({
    id: commentId,
    threadId,
    authorId: userId,
    body,
    mentions,
    createdAt: now,
  });
  await notify(thread, commentId, userId, mentions, memberIds);
  // A reply reopens a resolved thread (someone still has something to say)
  await db
    .update(commentThreads)
    .set({ updatedAt: now, resolvedAt: null, resolvedBy: null })
    .where(eq(commentThreads.id, threadId));
  return (await getThread(threadId))!;
}

export async function setResolved(
  threadId: string,
  userId: string,
  resolved: boolean,
): Promise<ThreadView> {
  const now = new Date();
  await db
    .update(commentThreads)
    .set({
      resolvedAt: resolved ? now : null,
      resolvedBy: resolved ? userId : null,
      updatedAt: now,
    })
    .where(eq(commentThreads.id, threadId));
  return (await getThread(threadId))!;
}

export async function editComment(
  commentId: string,
  projectId: string,
  body: string,
  rawMentions: string[],
): Promise<void> {
  const members = await getProjectMembers(projectId);
  const mentions = validMentions(rawMentions, new Set(members.map((m) => m.id)));
  await db
    .update(comments)
    .set({ body, mentions, editedAt: new Date() })
    .where(eq(comments.id, commentId));
}

/** Delete a comment; a thread left with no comments goes too. */
export async function deleteComment(commentId: string, threadId: string): Promise<boolean> {
  await db.delete(comments).where(eq(comments.id, commentId));
  const left = await db.query.comments.findFirst({ where: eq(comments.threadId, threadId) });
  if (!left) {
    await db.delete(commentThreads).where(eq(commentThreads.id, threadId));
    return true;
  }
  return false;
}

export async function deleteThread(threadId: string): Promise<void> {
  await db.delete(commentThreads).where(eq(commentThreads.id, threadId));
}

// ── Notifications ────────────────────────────────────────────

export interface NotificationView {
  id: string;
  type: NotificationType;
  projectId: string;
  projectName: string;
  diagramId: string;
  diagramTitle: string;
  threadId: string;
  commentId: string;
  actor: { id: string; name: string };
  excerpt: string;
  readAt: string | null;
  createdAt: string;
}

export async function listNotifications(userId: string, limit = 50): Promise<NotificationView[]> {
  const rows = await db
    .select({
      n: notifications,
      actorName: users.name,
      projectName: projects.name,
      diagramTitle: diagrams.title,
      body: comments.body,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.actorId))
    .innerJoin(projects, eq(projects.id, notifications.projectId))
    .innerJoin(diagrams, eq(diagrams.id, notifications.diagramId))
    .innerJoin(comments, eq(comments.id, notifications.commentId))
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map(({ n, actorName, projectName, diagramTitle, body }) => ({
    id: n.id,
    type: n.type,
    projectId: n.projectId,
    projectName,
    diagramId: n.diagramId,
    diagramTitle,
    threadId: n.threadId,
    commentId: n.commentId,
    actor: { id: n.actorId, name: actorName },
    excerpt: body.length > 140 ? `${body.slice(0, 139)}…` : body,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<void> {
  const mine = and(eq(notifications.userId, userId), isNull(notifications.readAt));
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(ids && ids.length > 0 ? and(mine, inArray(notifications.id, ids)) : mine);
}

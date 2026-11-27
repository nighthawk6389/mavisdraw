import { nanoid } from 'nanoid';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  invites,
  projectPermissions,
  projects,
  users,
  workspaceMembers,
  workspaces,
  type PermissionRole,
  type WorkspaceRole,
} from '../db/schema.js';
import { config } from '../config.js';
import { addedEmail, inviteEmail, isMailEnabled, sendMail } from './mailer.js';

const PROJECT_RANK: Record<PermissionRole, number> = { viewer: 0, editor: 1, admin: 2 };
const WORKSPACE_RANK: Record<WorkspaceRole, number> = { member: 0, admin: 1, owner: 2 };

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

// ── Workspaces ───────────────────────────────────────────────

export async function listWorkspacesFor(userId: string) {
  const memberships = await db.query.workspaceMembers.findMany({
    where: eq(workspaceMembers.userId, userId),
  });
  if (memberships.length === 0) return [];
  const ids = memberships.map((m) => m.workspaceId);
  const rows = await db.query.workspaces.findMany({ where: inArray(workspaces.id, ids) });
  const counts = await db.query.workspaceMembers.findMany({
    where: inArray(workspaceMembers.workspaceId, ids),
    columns: { workspaceId: true },
  });
  return rows
    .map((w) => ({
      id: w.id,
      name: w.name,
      role: memberships.find((m) => m.workspaceId === w.id)!.role,
      memberCount: counts.filter((c) => c.workspaceId === w.id).length,
      createdAt: w.createdAt.toISOString(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createWorkspace(name: string, userId: string) {
  const id = nanoid();
  const now = new Date();
  await db.insert(workspaces).values({ id, name, createdBy: userId, createdAt: now });
  await db
    .insert(workspaceMembers)
    .values({ id: nanoid(), workspaceId: id, userId, role: 'owner', createdAt: now });
  return { id, name, role: 'owner' as const, memberCount: 1, createdAt: now.toISOString() };
}

export async function getWorkspaceRole(workspaceId: string, userId: string) {
  const m = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
  });
  return m?.role ?? null;
}

export async function listMembers(workspaceId: string) {
  const rows = await db
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      name: users.name,
      email: users.email,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  return rows.sort(
    (a, b) => WORKSPACE_RANK[b.role] - WORKSPACE_RANK[a.role] || a.name.localeCompare(b.name),
  );
}

/** Add someone (or raise their role — an invite never demotes). */
export async function addMember(workspaceId: string, userId: string, role: WorkspaceRole) {
  const existing = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
  });
  if (!existing) {
    await db
      .insert(workspaceMembers)
      .values({ id: nanoid(), workspaceId, userId, role, createdAt: new Date() });
  } else if (WORKSPACE_RANK[role] > WORKSPACE_RANK[existing.role]) {
    await db.update(workspaceMembers).set({ role }).where(eq(workspaceMembers.id, existing.id));
  }
}

async function ownerCount(workspaceId: string): Promise<number> {
  const owners = await db.query.workspaceMembers.findMany({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')),
    columns: { id: true },
  });
  return owners.length;
}

export class WorkspaceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function setMemberRole(workspaceId: string, userId: string, role: WorkspaceRole) {
  const current = await getWorkspaceRole(workspaceId, userId);
  if (!current) throw new WorkspaceError('Not a member', 404);
  if (current === 'owner' && role !== 'owner' && (await ownerCount(workspaceId)) <= 1) {
    throw new WorkspaceError('A workspace needs at least one owner');
  }
  await db
    .update(workspaceMembers)
    .set({ role })
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
}

export async function removeMember(workspaceId: string, userId: string) {
  const current = await getWorkspaceRole(workspaceId, userId);
  if (!current) return;
  if (current === 'owner' && (await ownerCount(workspaceId)) <= 1) {
    throw new WorkspaceError('A workspace needs at least one owner');
  }
  await db
    .delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
}

export async function projectIdsInWorkspace(workspaceId: string): Promise<string[]> {
  const rows = await db.query.projects.findMany({
    where: eq(projects.workspaceId, workspaceId),
    columns: { id: true },
  });
  return rows.map((r) => r.id);
}

// ── Invites ──────────────────────────────────────────────────

export type InviteKind = 'project' | 'workspace';

/** Give a user what an invite grants (never lowering a role they already have). */
export async function grant(kind: InviteKind, targetId: string, userId: string, role: string) {
  if (kind === 'workspace') {
    await addMember(targetId, userId, role as WorkspaceRole);
    return;
  }
  const project = await db.query.projects.findFirst({ where: eq(projects.id, targetId) });
  if (!project || project.ownerId === userId) return;
  const existing = await db.query.projectPermissions.findFirst({
    where: and(eq(projectPermissions.projectId, targetId), eq(projectPermissions.userId, userId)),
  });
  const wanted = role as PermissionRole;
  if (!existing) {
    const now = new Date();
    await db.insert(projectPermissions).values({
      id: nanoid(),
      projectId: targetId,
      userId,
      role: wanted,
      createdAt: now,
      updatedAt: now,
    });
  } else if (PROJECT_RANK[wanted] > PROJECT_RANK[existing.role]) {
    await db
      .update(projectPermissions)
      .set({ role: wanted, updatedAt: new Date() })
      .where(eq(projectPermissions.id, existing.id));
  }
}

/**
 * Invite an email address. Someone who already has an account gets access
 * right away; anyone else gets a pending invite (and a link to send them),
 * claimed when they sign up or log in with that email.
 */
export async function inviteByEmail(input: {
  kind: InviteKind;
  targetId: string;
  email: string;
  role: string;
  invitedBy: string;
}): Promise<
  | { status: 'added'; userId: string; emailed: boolean }
  | { status: 'invited'; token: string; emailed: boolean }
> {
  const email = normalizeEmail(input.email);
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (user) {
    await grant(input.kind, input.targetId, user.id, input.role);
    const emailed = await emailAbout(input, email, null);
    return { status: 'added', userId: user.id, emailed };
  }
  const pending = await db.query.invites.findFirst({
    where: and(
      eq(invites.kind, input.kind),
      eq(invites.targetId, input.targetId),
      eq(invites.email, email),
      isNull(invites.acceptedAt),
    ),
  });
  if (pending) {
    await db.update(invites).set({ role: input.role }).where(eq(invites.id, pending.id));
    return {
      status: 'invited',
      token: pending.token,
      emailed: await emailAbout(input, email, pending.token),
    };
  }
  const token = nanoid(32);
  await db.insert(invites).values({
    id: nanoid(),
    kind: input.kind,
    targetId: input.targetId,
    email,
    role: input.role,
    token,
    invitedBy: input.invitedBy,
    createdAt: new Date(),
  });
  return { status: 'invited', token, emailed: await emailAbout(input, email, token) };
}

/** Tell them by email: an invite link (no account yet) or "you've been added". */
async function emailAbout(
  input: { kind: InviteKind; targetId: string; invitedBy: string },
  to: string,
  token: string | null,
): Promise<boolean> {
  if (!isMailEnabled()) return false;
  const inviter = await db.query.users.findFirst({
    where: eq(users.id, input.invitedBy),
    columns: { name: true },
  });
  const targetName =
    input.kind === 'workspace'
      ? (await db.query.workspaces.findFirst({ where: eq(workspaces.id, input.targetId) }))?.name
      : (await db.query.projects.findFirst({ where: eq(projects.id, input.targetId) }))?.name;
  const details = {
    to,
    inviterName: inviter?.name ?? 'Someone',
    kind: input.kind,
    targetName: targetName ?? (input.kind === 'workspace' ? 'a workspace' : 'a project'),
  };
  const link = token
    ? `${config.appUrl}/invite/${token}`
    : input.kind === 'project'
      ? `${config.appUrl}/p/${input.targetId}`
      : `${config.appUrl}/?workspace=${encodeURIComponent(input.targetId)}`;
  return sendMail(token ? inviteEmail({ ...details, link }) : addedEmail({ ...details, link }));
}

export async function listPendingInvites(kind: InviteKind, targetId: string) {
  const rows = await db.query.invites.findMany({
    where: and(eq(invites.kind, kind), eq(invites.targetId, targetId), isNull(invites.acceptedAt)),
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    token: r.token,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function revokeInvite(id: string, kind: InviteKind, targetId: string) {
  await db
    .delete(invites)
    .where(and(eq(invites.id, id), eq(invites.kind, kind), eq(invites.targetId, targetId)));
}

/** Grant every pending invite for this email (called on sign-up and log-in). */
export async function claimInvitesForEmail(userId: string, email: string): Promise<number> {
  const pending = await db.query.invites.findMany({
    where: and(eq(invites.email, normalizeEmail(email)), isNull(invites.acceptedAt)),
  });
  for (const invite of pending) {
    await grant(invite.kind, invite.targetId, userId, invite.role);
    await db
      .update(invites)
      .set({ acceptedAt: new Date(), acceptedBy: userId })
      .where(eq(invites.id, invite.id));
  }
  return pending.length;
}

/** What an invite link is for (shown before signing in). */
export async function describeInvite(token: string) {
  const invite = await db.query.invites.findFirst({ where: eq(invites.token, token) });
  if (!invite) return null;
  const targetName =
    invite.kind === 'workspace'
      ? ((await db.query.workspaces.findFirst({ where: eq(workspaces.id, invite.targetId) }))
          ?.name ?? 'a workspace')
      : ((await db.query.projects.findFirst({ where: eq(projects.id, invite.targetId) }))?.name ??
        'a project');
  const inviter = invite.invitedBy
    ? await db.query.users.findFirst({
        where: eq(users.id, invite.invitedBy),
        columns: { name: true },
      })
    : undefined;
  return {
    invite,
    view: {
      kind: invite.kind,
      targetId: invite.targetId,
      targetName,
      invitedBy: inviter?.name ?? null,
      email: invite.email,
      role: invite.role,
      accepted: invite.acceptedAt !== null,
    },
  };
}

/**
 * Accept an invite link. It's for one email address: accepting it from a
 * different account would let a forwarded link grant access to anyone.
 */
export async function acceptInvite(token: string, userId: string, userEmail: string) {
  const found = await describeInvite(token);
  if (!found) throw new WorkspaceError('Invite not found', 404);
  const { invite } = found;
  if (invite.email !== normalizeEmail(userEmail)) {
    throw new WorkspaceError(
      `This invite is for ${invite.email}. Sign in with that email to accept it.`,
      403,
    );
  }
  if (!invite.acceptedAt) {
    await grant(invite.kind, invite.targetId, userId, invite.role);
    await db
      .update(invites)
      .set({ acceptedAt: new Date(), acceptedBy: userId })
      .where(eq(invites.id, invite.id));
  }
  return { kind: invite.kind, targetId: invite.targetId };
}

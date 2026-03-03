import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { projectPermissions, projects, users } from '../db/schema.js';
import type { PermissionRole } from '../db/schema.js';

export interface ShareLinkResult {
  id: string;
  shareToken: string;
  role: PermissionRole;
  projectId: string;
  createdAt: string;
}

export async function createShareLink(
  projectId: string,
  role: PermissionRole,
): Promise<ShareLinkResult> {
  const shareToken = nanoid(32);
  const now = new Date();

  const [permission] = await db
    .insert(projectPermissions)
    .values({
      id: nanoid(),
      projectId,
      role,
      shareToken,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return {
    id: permission.id,
    shareToken: permission.shareToken!,
    role: permission.role,
    projectId: permission.projectId,
    createdAt: permission.createdAt.toISOString(),
  };
}

export async function resolveShareToken(
  shareToken: string,
  userId: string,
): Promise<{ projectId: string; role: PermissionRole } | null> {
  const permission = await db.query.projectPermissions.findFirst({
    where: eq(projectPermissions.shareToken, shareToken),
  });

  if (!permission) return null;

  // Check if user already has access
  const existing = await db.query.projectPermissions.findFirst({
    where: and(
      eq(projectPermissions.projectId, permission.projectId),
      eq(projectPermissions.userId, userId),
    ),
  });

  if (existing) {
    return { projectId: permission.projectId, role: existing.role };
  }

  // Grant access to the user
  await db.insert(projectPermissions).values({
    id: nanoid(),
    projectId: permission.projectId,
    userId,
    role: permission.role,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { projectId: permission.projectId, role: permission.role };
}

export async function getProjectPermissions(projectId: string) {
  const permissions = await db.query.projectPermissions.findMany({
    where: eq(projectPermissions.projectId, projectId),
    with: { user: true },
  });

  return permissions.map((p) => ({
    id: p.id,
    userId: p.userId,
    email: p.email ?? p.user?.email ?? null,
    name: p.user?.name ?? null,
    role: p.role,
    shareToken: p.shareToken,
    createdAt: p.createdAt.toISOString(),
  }));
}

export async function updatePermission(permissionId: string, role: PermissionRole) {
  const [updated] = await db
    .update(projectPermissions)
    .set({ role, updatedAt: new Date() })
    .where(eq(projectPermissions.id, permissionId))
    .returning();

  return updated;
}

export async function revokePermission(permissionId: string) {
  await db.delete(projectPermissions).where(eq(projectPermissions.id, permissionId));
}

export async function revokeUserAccess(projectId: string, userId: string) {
  await db
    .delete(projectPermissions)
    .where(
      and(eq(projectPermissions.projectId, projectId), eq(projectPermissions.userId, userId)),
    );
}

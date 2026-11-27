import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { projectEmbeds, projects } from '../db/schema.js';

/**
 * A project published as a public, read-only embed (iframe viewer and
 * README image). The token in the URL is the only key: rotating it breaks
 * old links, unpublishing removes it.
 */

export interface EmbedInfo {
  token: string;
  createdAt: string;
}

export const looksLikeEmbedToken = (value: string) => /^[A-Za-z0-9_-]{16,64}$/.test(value);

export async function getEmbed(projectId: string): Promise<EmbedInfo | null> {
  const row = await db.query.projectEmbeds.findFirst({
    where: eq(projectEmbeds.projectId, projectId),
  });
  return row ? { token: row.token, createdAt: row.createdAt.toISOString() } : null;
}

/** Publish (or get the existing embed); `rotate` replaces its token. */
export async function publishEmbed(
  projectId: string,
  userId: string,
  rotate = false,
): Promise<EmbedInfo> {
  const existing = await getEmbed(projectId);
  if (existing && !rotate) return existing;
  const token = nanoid(24);
  const [row] = await db
    .insert(projectEmbeds)
    .values({ projectId, token, createdBy: userId })
    .onConflictDoUpdate({
      target: projectEmbeds.projectId,
      set: { token, createdBy: userId, createdAt: new Date() },
    })
    .returning();
  return { token: row.token, createdAt: row.createdAt.toISOString() };
}

export async function unpublishEmbed(projectId: string): Promise<boolean> {
  const deleted = await db
    .delete(projectEmbeds)
    .where(eq(projectEmbeds.projectId, projectId))
    .returning({ projectId: projectEmbeds.projectId });
  return deleted.length > 0;
}

/** The project behind a public embed token, or null. */
export async function resolveEmbed(
  token: string,
): Promise<{ id: string; name: string; rootDiagramId: string | null } | null> {
  if (!looksLikeEmbedToken(token)) return null;
  const [row] = await db
    .select({ id: projects.id, name: projects.name, rootDiagramId: projects.rootDiagramId })
    .from(projectEmbeds)
    .innerJoin(projects, eq(projects.id, projectEmbeds.projectId))
    .where(eq(projectEmbeds.token, token));
  return row ?? null;
}

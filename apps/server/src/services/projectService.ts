import { eq, inArray } from 'drizzle-orm';
import type { Document } from '@hocuspocus/server';
import type { Diagram, MavisDrawScene, MavisElement, RenderMode } from '@mavisdraw/types';
import { db } from '../db/client.js';
import { projects, projectPermissions, workspaceMembers } from '../db/schema.js';
import { combineAccess, getDiagramsByProject, type ProjectAccess } from './diagramService.js';
import { documentNameFor } from '../ws/hocuspocus.js';
import { readLiveElements } from '../ws/ydocElements.js';

export type ProjectRow = typeof projects.$inferSelect;

/** Everything someone can open: owned, shared with them, and in their workspaces. */
export async function listAccessibleProjects(
  userId: string,
): Promise<Array<ProjectRow & { role: ProjectAccess }>> {
  const owned = await db.query.projects.findMany({ where: eq(projects.ownerId, userId) });
  const shares = await db.query.projectPermissions.findMany({
    where: eq(projectPermissions.userId, userId),
    with: { project: true },
  });
  const memberships = await db.query.workspaceMembers.findMany({
    where: eq(workspaceMembers.userId, userId),
  });
  const workspaceProjects = memberships.length
    ? await db.query.projects.findMany({
        where: inArray(
          projects.workspaceId,
          memberships.map((m) => m.workspaceId),
        ),
      })
    : [];

  const byId = new Map<string, ProjectRow>();
  for (const p of [
    ...owned,
    ...shares.map((s) => s.project!).filter(Boolean),
    ...workspaceProjects,
  ]) {
    byId.set(p.id, p);
  }
  const shareRole = new Map(shares.map((s) => [s.projectId, s.role]));
  const workspaceRole = new Map(memberships.map((m) => [m.workspaceId, m.role]));

  return Array.from(byId.values())
    .map((p) => ({
      ...p,
      role: combineAccess({
        isOwner: p.ownerId === userId,
        projectRole: shareRole.get(p.id),
        workspaceRole: p.workspaceId ? workspaceRole.get(p.workspaceId) : undefined,
        isPublic: false,
      }),
    }))
    .filter((p): p is ProjectRow & { role: ProjectAccess } => p.role !== null)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/**
 * A project's whole nested map as it is right now: diagrams someone has
 * open live are read from the collaboration room (newer than the database).
 */
export async function loadProjectScene(
  project: Pick<ProjectRow, 'id' | 'rootDiagramId'>,
  documents: Map<string, Document>,
): Promise<MavisDrawScene> {
  const rows = await getDiagramsByProject(project.id);
  const diagrams: Diagram[] = rows.map((d) => ({
    id: d.id,
    projectId: d.projectId,
    parentDiagramId: d.parentDiagramId,
    parentPortalId: d.parentPortalId,
    title: d.title,
    viewBackgroundColor: d.viewBackgroundColor,
    gridEnabled: d.gridEnabled,
    gridSize: d.gridSize,
    renderMode: d.renderMode as RenderMode,
    layers: [],
    createdBy: d.createdBy,
    createdAt: d.createdAt.getTime(),
    updatedAt: d.updatedAt.getTime(),
  }));
  const elements: MavisElement[] = [];
  for (const d of rows) {
    const live = documents.get(documentNameFor(d.id));
    const list = live ? readLiveElements(live) : ((d.elements as unknown[]) ?? []);
    elements.push(...(list as MavisElement[]));
  }
  const rootDiagramId =
    project.rootDiagramId ?? rows.find((d) => !d.parentDiagramId)?.id ?? rows[0]?.id ?? '';
  return { diagrams, elements, rootDiagramId };
}

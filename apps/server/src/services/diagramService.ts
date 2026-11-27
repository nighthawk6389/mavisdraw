import { nanoid } from 'nanoid';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  diagrams,
  diagramSnapshots,
  projects,
  projectPermissions,
  workspaceMembers,
} from '../db/schema.js';
import type { PermissionRole, WorkspaceRole } from '../db/schema.js';

export interface CreateDiagramInput {
  /** Client-chosen id (validated by the route); generated when omitted. */
  id?: string;
  projectId: string;
  parentDiagramId?: string | null;
  parentPortalId?: string | null;
  title?: string;
  userId: string;
}

export interface UpdateDiagramInput {
  title?: string;
  elements?: unknown[];
  viewBackgroundColor?: string;
  gridEnabled?: boolean;
  gridSize?: number;
  renderMode?: string;
  layers?: unknown[];
  yjsState?: string | null;
}

export async function createDiagram(input: CreateDiagramInput) {
  const id = input.id ?? nanoid();
  const now = new Date();

  const [diagram] = await db
    .insert(diagrams)
    .values({
      id,
      projectId: input.projectId,
      parentDiagramId: input.parentDiagramId ?? null,
      parentPortalId: input.parentPortalId ?? null,
      title: input.title ?? 'Untitled Diagram',
      elements: [],
      layers: [
        {
          id: nanoid(),
          name: 'Layer 1',
          isVisible: true,
          isLocked: false,
          opacity: 100,
          order: 0,
        },
      ],
      createdBy: input.userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return diagram;
}

export async function getDiagram(id: string) {
  return db.query.diagrams.findFirst({
    where: eq(diagrams.id, id),
  });
}

export async function getDiagramsByProject(projectId: string) {
  return db.query.diagrams.findMany({
    where: eq(diagrams.projectId, projectId),
  });
}

/**
 * The project's diagram hierarchy without contents: elements and the CRDT
 * state can be megabytes per diagram and are loaded per diagram on open.
 */
/** Just the ids (e.g. to signal a project's rooms): never the contents. */
export async function getDiagramIds(projectId: string): Promise<Array<{ id: string }>> {
  return db.query.diagrams.findMany({
    where: eq(diagrams.projectId, projectId),
    columns: { id: true },
  });
}

export async function getDiagramSummaries(projectId: string) {
  return db.query.diagrams.findMany({
    where: eq(diagrams.projectId, projectId),
    columns: { elements: false, yjsState: false },
  });
}

export async function updateDiagram(id: string, updates: UpdateDiagramInput) {
  const [diagram] = await db
    .update(diagrams)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(diagrams.id, id))
    .returning();

  return diagram;
}

export async function deleteDiagram(id: string) {
  await db.delete(diagrams).where(eq(diagrams.id, id));
}

export async function createSnapshot(
  diagramId: string,
  userId: string,
  trigger: 'auto' | 'manual' = 'auto',
  label?: string,
  /** Live elements (from an open collaboration document), if fresher than the DB. */
  liveElements?: unknown[],
) {
  const diagram = await getDiagram(diagramId);
  if (!diagram) throw new Error('Diagram not found');

  // Version numbers are max+1 per diagram (unique). Two people saving a
  // version at the same moment race for the same number: retry, don't 500.
  let snapshot: typeof diagramSnapshots.$inferSelect | undefined;
  for (let attempt = 0; !snapshot; attempt++) {
    const latestSnapshot = await db.query.diagramSnapshots.findFirst({
      where: eq(diagramSnapshots.diagramId, diagramId),
      orderBy: [desc(diagramSnapshots.version)],
      columns: { version: true },
    });
    try {
      [snapshot] = await db
        .insert(diagramSnapshots)
        .values({
          id: nanoid(),
          diagramId,
          version: (latestSnapshot?.version ?? 0) + 1,
          elements: liveElements ?? diagram.elements,
          appState: {
            viewBackgroundColor: diagram.viewBackgroundColor,
            gridEnabled: diagram.gridEnabled,
            gridSize: diagram.gridSize,
            renderMode: diagram.renderMode,
            layers: diagram.layers,
          },
          createdBy: userId,
          trigger,
          label: label ?? null,
        })
        .returning();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== '23505' || attempt >= 4) throw err;
    }
  }

  // Keep the history useful: automatic snapshots are capped per diagram
  if (trigger === 'auto') await pruneAutoSnapshots(diagramId);

  return snapshot;
}

export async function getSnapshots(diagramId: string, limit = 50, offset = 0) {
  return db.query.diagramSnapshots.findMany({
    where: eq(diagramSnapshots.diagramId, diagramId),
    orderBy: [desc(diagramSnapshots.version)],
    limit,
    offset,
  });
}

export async function getSnapshot(snapshotId: string) {
  return db.query.diagramSnapshots.findFirst({
    where: eq(diagramSnapshots.id, snapshotId),
  });
}

export type ProjectAccess = PermissionRole | 'owner';

const RANK: Record<ProjectAccess, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

/** What a workspace role means for the workspace's projects. */
export function accessFromWorkspace(role: WorkspaceRole | null | undefined): PermissionRole | null {
  if (!role) return null;
  return role === 'member' ? 'editor' : 'admin';
}

/**
 * Someone's effective role in a project: the owner; otherwise the highest of
 * their direct share and what their workspace membership grants; otherwise
 * viewer for a public project.
 */
export function combineAccess(input: {
  isOwner: boolean;
  projectRole: PermissionRole | null | undefined;
  workspaceRole: WorkspaceRole | null | undefined;
  isPublic: boolean;
}): ProjectAccess | null {
  if (input.isOwner) return 'owner';
  const candidates = [input.projectRole ?? null, accessFromWorkspace(input.workspaceRole)].filter(
    (r): r is PermissionRole => r !== null,
  );
  if (candidates.length > 0) {
    return candidates.reduce((best, r) => (RANK[r] > RANK[best] ? r : best));
  }
  return input.isPublic ? 'viewer' : null;
}

export async function checkProjectAccess(
  projectId: string,
  userId: string,
): Promise<ProjectAccess | null> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project) return null;
  if (project.ownerId === userId) return 'owner';

  const permission = await db.query.projectPermissions.findFirst({
    where: and(
      eq(projectPermissions.projectId, projectId),
      eq(projectPermissions.userId, userId),
    ),
  });
  const membership = project.workspaceId
    ? await db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, project.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      })
    : undefined;

  return combineAccess({
    isOwner: false,
    projectRole: permission?.role,
    workspaceRole: membership?.role,
    isPublic: project.isPublic,
  });
}

const MAX_AUTO_SNAPSHOTS = 50;

async function pruneAutoSnapshots(diagramId: string): Promise<void> {
  const autos = await db.query.diagramSnapshots.findMany({
    where: and(eq(diagramSnapshots.diagramId, diagramId), eq(diagramSnapshots.trigger, 'auto')),
    orderBy: [desc(diagramSnapshots.version)],
    columns: { id: true },
  });
  const stale = autos.slice(MAX_AUTO_SNAPSHOTS).map((s) => s.id);
  if (stale.length > 0) await db.delete(diagramSnapshots).where(inArray(diagramSnapshots.id, stale));
}

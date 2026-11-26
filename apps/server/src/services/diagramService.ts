import { nanoid } from 'nanoid';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { diagrams, diagramSnapshots, projects, projectPermissions } from '../db/schema.js';
import type { PermissionRole } from '../db/schema.js';

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

export async function checkProjectAccess(
  projectId: string,
  userId: string,
): Promise<PermissionRole | 'owner' | null> {
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

  // Public projects can be opened (read-only) by anyone signed in
  return permission?.role ?? (project.isPublic ? 'viewer' : null);
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

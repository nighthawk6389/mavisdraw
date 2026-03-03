import { nanoid } from 'nanoid';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { diagrams, diagramSnapshots, projects, projectPermissions } from '../db/schema.js';
import type { PermissionRole } from '../db/schema.js';

export interface CreateDiagramInput {
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
}

export async function createDiagram(input: CreateDiagramInput) {
  const id = nanoid();
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
) {
  const diagram = await getDiagram(diagramId);
  if (!diagram) throw new Error('Diagram not found');

  // Get the latest version number
  const latestSnapshot = await db.query.diagramSnapshots.findFirst({
    where: eq(diagramSnapshots.diagramId, diagramId),
    orderBy: [desc(diagramSnapshots.version)],
  });
  const nextVersion = (latestSnapshot?.version ?? 0) + 1;

  const [snapshot] = await db
    .insert(diagramSnapshots)
    .values({
      id: nanoid(),
      diagramId,
      version: nextVersion,
      elements: diagram.elements,
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

  return permission?.role ?? null;
}

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Document } from '@hocuspocus/server';
import type {
  ComponentDetails,
  ProjectModel,
  StoredComponent,
  StoredRelationship,
} from '@mavisdraw/types';
import { buildProjectModel, renameEdits } from '@mavisdraw/llm';
import { db } from '../db/client.js';
import { diagrams, modelComponents, modelRelationships, type RepoSource } from '../db/schema.js';
import { loadProjectScene } from './projectService.js';
import { changeDiagramElements, type Rooms } from './diagramContents.js';
import { documentNameFor, persistDocument } from '../ws/hocuspocus.js';
import { patchElements } from '../ws/ydocElements.js';

/**
 * The project's architecture model (docs/model-layer.md): computed from the
 * diagrams (live rooms first) plus the two model tables.
 */

interface ProjectRef {
  id: string;
  rootDiagramId: string | null;
  repoSource?: RepoSource | null;
}

export async function loadStoredModel(
  projectId: string,
): Promise<{ components: StoredComponent[]; relationships: StoredRelationship[] }> {
  const [components, relationships] = await Promise.all([
    db.query.modelComponents.findMany({ where: eq(modelComponents.projectId, projectId) }),
    db.query.modelRelationships.findMany({ where: eq(modelRelationships.projectId, projectId) }),
  ]);
  return {
    components: components.map((c) => ({
      id: c.id,
      name: c.name,
      ...(c.kind ? { kind: c.kind as StoredComponent['kind'] } : {}),
      description: c.description,
      technology: c.technology,
      owner: c.owner,
      tags: c.tags,
      links: c.links,
    })),
    relationships: relationships.map((r) => ({
      sourceId: r.sourceId,
      targetId: r.targetId,
      description: r.description,
      technology: r.technology,
    })),
  };
}

export async function getProjectModel(
  project: ProjectRef,
  documents: Map<string, Document>,
): Promise<ProjectModel> {
  const [scene, stored] = await Promise.all([
    loadProjectScene(project, documents),
    loadStoredModel(project.id),
  ]);
  const source = project.repoSource;
  const repo = source?.kind === 'github' && source.owner ? `${source.owner}/${source.repo}` : null;
  return buildProjectModel(scene, stored, { repo });
}

export class ModelError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Record a component's details (creating its row if needed). */
export async function saveComponentDetails(
  projectId: string,
  componentId: string,
  input: ComponentDetails & { name: string },
  userId: string,
): Promise<void> {
  const values = {
    name: input.name,
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.technology !== undefined ? { technology: input.technology } : {}),
    ...(input.owner !== undefined ? { owner: input.owner } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.links !== undefined ? { links: input.links } : {}),
    updatedBy: userId,
    updatedAt: new Date(),
  };
  await db
    .insert(modelComponents)
    .values({ projectId, id: componentId, ...values })
    .onConflictDoUpdate({ target: [modelComponents.projectId, modelComponents.id], set: values });
}

/** A component that exists only in the model (not drawn anywhere yet). */
export async function createModelComponent(
  projectId: string,
  input: ComponentDetails & { name: string },
  userId: string,
): Promise<string> {
  const id = `c_${nanoid(12)}`;
  await saveComponentDetails(projectId, id, input, userId);
  return id;
}

/** Forget a component's recorded details (a model-only component disappears). */
export async function deleteComponentDetails(projectId: string, componentId: string) {
  await db
    .delete(modelComponents)
    .where(and(eq(modelComponents.projectId, projectId), eq(modelComponents.id, componentId)));
  // Recorded relationships to it go too; drawn ones live on as arrows
  await db
    .delete(modelRelationships)
    .where(
      and(
        eq(modelRelationships.projectId, projectId),
        eq(modelRelationships.sourceId, componentId),
      ),
    );
  await db
    .delete(modelRelationships)
    .where(
      and(
        eq(modelRelationships.projectId, projectId),
        eq(modelRelationships.targetId, componentId),
      ),
    );
}

export async function saveRelationship(
  projectId: string,
  input: StoredRelationship,
  userId: string,
): Promise<void> {
  if (input.sourceId === input.targetId) {
    throw new ModelError('A component can’t depend on itself');
  }
  const values = {
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.technology !== undefined ? { technology: input.technology } : {}),
    updatedBy: userId,
    updatedAt: new Date(),
  };
  await db
    .insert(modelRelationships)
    .values({ projectId, sourceId: input.sourceId, targetId: input.targetId, ...values })
    .onConflictDoUpdate({
      target: [
        modelRelationships.projectId,
        modelRelationships.sourceId,
        modelRelationships.targetId,
      ],
      set: values,
    });
}

export async function deleteRelationship(projectId: string, sourceId: string, targetId: string) {
  await db
    .delete(modelRelationships)
    .where(
      and(
        eq(modelRelationships.projectId, projectId),
        eq(modelRelationships.sourceId, sourceId),
        eq(modelRelationships.targetId, targetId),
      ),
    );
}

/** A diagram's live room, waiting for one that's still loading. */
/**
 * Change elements of one diagram as an edit: in its live room when one is
 * open (everyone sees it at once; the room persists itself), otherwise
 * through its stored CRDT state, so a room opened later doesn't undo it.
 */
export async function patchDiagramElements(
  rooms: Rooms,
  diagramId: string,
  patches: Array<{ id: string; changes: Record<string, unknown> }>,
): Promise<number> {
  if (patches.length === 0) return 0;
  const outcome = await changeDiagramElements(rooms, diagramId, (doc) =>
    patchElements(doc, patches),
  );
  if (!outcome) return 0;
  // Saved now, not on the room's debounce: a room nobody is in any more may
  // be unloading, and an edit after its last save would go with it
  if (outcome.live && outcome.result.length > 0) {
    await persistDocument(documentNameFor(diagramId), outcome.live);
  }
  return outcome.result.length;
}

/**
 * Rename a component everywhere: the label of every appearance (live rooms
 * and stored diagrams) and the title of the diagram it opens into. The row
 * keeps the name too (it's the name of a model-only component).
 */
export async function renameComponent(
  project: ProjectRef,
  componentId: string,
  name: string,
  rooms: Rooms,
  userId: string,
): Promise<{ labels: number; diagrams: string[] }> {
  const scene = await loadProjectScene(project, rooms.documents);
  const edits = renameEdits(scene, componentId, name);
  const ours = new Set(scene.diagrams.map((d) => d.id));
  const byDiagram = new Map<string, Array<{ id: string; changes: Record<string, unknown> }>>();
  for (const e of edits.elements) {
    // Only this project's diagrams, whatever an element claims
    if (!ours.has(e.diagramId)) continue;
    const list = byDiagram.get(e.diagramId) ?? [];
    list.push({ id: e.id, changes: e.changes });
    byDiagram.set(e.diagramId, list);
  }
  let labels = 0;
  for (const [diagramId, patches] of byDiagram) {
    labels += await patchDiagramElements(rooms, diagramId, patches);
  }
  for (const d of edits.diagrams) {
    await db
      .update(diagrams)
      .set({ title: d.title, updatedAt: new Date() })
      .where(and(eq(diagrams.id, d.id), eq(diagrams.projectId, project.id)));
  }
  const row = await db.query.modelComponents.findFirst({
    where: and(eq(modelComponents.projectId, project.id), eq(modelComponents.id, componentId)),
  });
  if (row) await saveComponentDetails(project.id, componentId, { name }, userId);
  return { labels, diagrams: edits.diagrams.map((d) => d.id) };
}

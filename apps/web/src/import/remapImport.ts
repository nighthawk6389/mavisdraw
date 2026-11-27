import { nanoid } from 'nanoid';
import type { Diagram, MavisElement } from '@mavisdraw/types';

/**
 * Bring an imported file's diagrams and elements into the open project.
 *
 * A file (a .mavisdraw export, Excalidraw, draw.io, a PNG with a scene) keeps
 * the ids of wherever it came from. Used as-is they point at another
 * project's diagrams (saves would go there, or be refused) and collide with
 * existing shapes when the same file is imported twice. So the file's
 * top-level diagram is merged into `target` (the diagram on screen), its
 * nested diagrams become new diagrams of this project, and every element,
 * diagram and group gets a fresh id, with the references between them
 * (portals, bindings, labels, groups) rewired.
 */
export function remapImport(
  file: { diagrams: Diagram[]; elements: MavisElement[]; rootDiagramId?: string },
  target: Pick<Diagram, 'id' | 'projectId' | 'createdBy'>,
  newId: () => string = nanoid,
): { diagrams: Diagram[]; elements: MavisElement[] } {
  const fileDiagramIds = new Set(file.diagrams.map((d) => d.id));
  const roots = new Set(
    file.rootDiagramId && fileDiagramIds.has(file.rootDiagramId)
      ? [file.rootDiagramId]
      : file.diagrams
          .filter((d) => !d.parentDiagramId || !fileDiagramIds.has(d.parentDiagramId))
          .map((d) => d.id),
  );

  const diagramIds = new Map<string, string>();
  for (const d of file.diagrams) diagramIds.set(d.id, roots.has(d.id) ? target.id : newId());
  // Elements of a diagram the file doesn't describe land on screen too
  const diagramFor = (id: string) => diagramIds.get(id) ?? target.id;

  const elementIds = new Map(file.elements.map((el) => [el.id, newId()]));
  const groupIds = new Map<string, string>();
  const groupFor = (id: string) => {
    if (!groupIds.has(id)) groupIds.set(id, newId());
    return groupIds.get(id)!;
  };

  const now = Date.now();
  const diagrams = file.diagrams
    .filter((d) => !roots.has(d.id))
    .map(
      (d): Diagram => ({
        ...d,
        id: diagramIds.get(d.id)!,
        projectId: target.projectId,
        parentDiagramId: d.parentDiagramId ? diagramFor(d.parentDiagramId) : target.id,
        parentPortalId: d.parentPortalId ? (elementIds.get(d.parentPortalId) ?? null) : null,
        createdBy: target.createdBy,
        createdAt: now,
        updatedAt: now,
      }),
    );

  const elements = file.elements.map((el) => {
    const source = el as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {
      ...source,
      id: elementIds.get(el.id)!,
      diagramId: diagramFor(el.diagramId),
      groupIds: (el.groupIds ?? []).map(groupFor),
    };
    const ref = (id: unknown) => (typeof id === 'string' ? elementIds.get(id) : undefined);
    if (Array.isArray(el.boundElements)) {
      out.boundElements = el.boundElements
        .filter((b) => elementIds.has(b.id))
        .map((b) => ({ ...b, id: ref(b.id)! }));
    }
    for (const key of ['startBinding', 'endBinding'] as const) {
      const binding = source[key] as { elementId: string } | null | undefined;
      if (binding)
        out[key] = ref(binding.elementId)
          ? { ...binding, elementId: ref(binding.elementId) }
          : null;
    }
    if (source.containerId) out.containerId = ref(source.containerId) ?? null;
    if (el.type === 'portal' && typeof source.targetDiagramId === 'string') {
      out.targetDiagramId = diagramFor(source.targetDiagramId);
    }
    return out as unknown as MavisElement;
  });

  return { diagrams, elements };
}

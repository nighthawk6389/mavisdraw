import type { Diagram, MavisElement } from '@mavisdraw/types';

/**
 * Tracks what the server holds for each diagram so autosave knows exactly
 * which diagrams have unsaved changes.
 */

// ── What the server has (per diagram) ──────────────────────────────────
// diagramId → (elementId → version) of the last successful save/load, plus
// the diagram metadata timestamp. Anything that differs is dirty.
const savedElements = new Map<string, Map<string, number>>();
const savedMeta = new Map<string, number>();

/** Record what the server holds for a diagram (after a load or a save). */
export function recordSaved(diagramId: string, elements: MavisElement[], metaUpdatedAt?: number): void {
  const versions = new Map<string, number>();
  for (const el of elements) {
    if (el.diagramId === diagramId && !el.isDeleted) versions.set(el.id, el.version);
  }
  savedElements.set(diagramId, versions);
  if (metaUpdatedAt !== undefined) savedMeta.set(diagramId, metaUpdatedAt);
}

export function resetSaveTracking(): void {
  savedElements.clear();
  savedMeta.clear();
}

function liveElementsByDiagram(elements: Map<string, MavisElement>): Map<string, MavisElement[]> {
  const byDiagram = new Map<string, MavisElement[]>();
  for (const el of elements.values()) {
    if (el.isDeleted) continue;
    let list = byDiagram.get(el.diagramId);
    if (!list) byDiagram.set(el.diagramId, (list = []));
    list.push(el);
  }
  return byDiagram;
}

/** Diagrams whose elements or metadata differ from what the server has. */
export function findDirtyDiagrams(
  elements: Map<string, MavisElement>,
  diagrams: Map<string, Diagram>,
): { diagram: Diagram; elements: MavisElement[] }[] {
  const byDiagram = liveElementsByDiagram(elements);
  const ids = new Set<string>([...byDiagram.keys(), ...savedElements.keys()]);
  const dirty: { diagram: Diagram; elements: MavisElement[] }[] = [];

  for (const id of ids) {
    const diagram = diagrams.get(id);
    if (!diagram) continue;
    const live = byDiagram.get(id) ?? [];
    const saved = savedElements.get(id);
    // Never seen by the server or by a load, and nothing in it: nothing to save
    if (!saved && live.length === 0) continue;

    let isDirty = !saved || saved.size !== live.length;
    if (!isDirty) {
      for (const el of live) {
        if (saved!.get(el.id) !== el.version) {
          isDirty = true;
          break;
        }
      }
    }
    const meta = savedMeta.get(id);
    if (meta !== undefined && meta !== diagram.updatedAt) isDirty = true;

    if (isDirty) dirty.push({ diagram, elements: live });
  }
  return dirty;
}


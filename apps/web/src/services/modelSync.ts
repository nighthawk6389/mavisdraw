import { nanoid } from 'nanoid';
import type {
  MavisElement,
  ModelComponent,
  ModelRelationship,
  PortalElement,
  ProjectModel,
  TextElement,
} from '@mavisdraw/types';
import { canShowComponent, componentById, getGivenLabel } from '@mavisdraw/llm';
import { onHistoryApplied, useElementsStore } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useModelStore } from '../stores/modelStore';
import { toast } from '../stores/toastStore';
import { connectElements, makeLabel } from '../editor/elementFactory';
import { apiListDiagrams, apiUpdateComponent } from './api';

/**
 * The editor's side of the architecture model (docs/model-layer.md): which
 * component a shape shows, and the edits that keep shapes and model in step.
 */

/** A shape's given label (portal label or bound text), or null. */
export function labelFor(elements: Map<string, MavisElement>, id: string): string | null {
  const el = elements.get(id);
  if (!el || el.isDeleted) return null;
  return getGivenLabel(el, elements);
}

/** The component a shape shows (same rule as the server's model). */
export function componentKeyFor(el: MavisElement, label: string | null): string | null {
  if (el.isDeleted || !canShowComponent(el)) return null;
  if (el.componentId) return el.componentId;
  return label ? el.id : null;
}

/** The text element labelling a shape, if any. */
function boundLabel(el: MavisElement, elements: Map<string, MavisElement>): TextElement | null {
  for (const b of el.boundElements) {
    const t = elements.get(b.id);
    if (b.type === 'text' && t?.type === 'text' && !t.isDeleted) return t as TextElement;
  }
  return null;
}

/** Set a shape's label text (its portal label or bound text). */
function setLabel(el: MavisElement, name: string) {
  const store = useElementsStore.getState();
  if (el.type === 'portal') {
    store.updateElement(el.id, { label: name } as Partial<PortalElement>);
    return;
  }
  const label = boundLabel(el, store.elements);
  if (label) store.updateElement(label.id, { text: name } as Partial<TextElement>);
}

/** This shape now shows `component` (and reads its name). One undo step. */
export function linkToComponent(elementId: string, component: ModelComponent) {
  const store = useElementsStore.getState();
  const el = store.elements.get(elementId);
  if (!el) return;
  store.beginHistoryBatch();
  try {
    store.updateElement(elementId, { componentId: component.id });
    setLabel(el, component.name);
  } finally {
    store.endHistoryBatch();
  }
  toast(`Linked to ${component.name}`, 'success');
  scheduleModelRefresh();
}

/** This shape becomes its own component (its other appearances stay together). */
export function unlinkComponent(elementId: string) {
  useElementsStore.getState().updateElement(elementId, { componentId: `c_${nanoid(12)}` });
  scheduleModelRefresh();
}

/** Open the diagram an appearance is on and select it once it's loaded. */
export function showAppearance(diagramId: string, elementId: string) {
  useDiagramStore.getState().navigateToDiagram(diagramId);
  const started = Date.now();
  const trySelect = () => {
    const el = useElementsStore.getState().elements.get(elementId);
    if (el && !el.isDeleted && useDiagramStore.getState().activeDiagramId === diagramId) {
      useSelectionStore.getState().select(elementId);
      return;
    }
    if (Date.now() - started < 5000) requestAnimationFrame(trySelect);
  };
  requestAnimationFrame(trySelect);
}

/** Draw a known relationship between the two shapes on this diagram. */
export function drawRelationshipHere(
  relationship: ModelRelationship,
  diagramId: string,
  model: ProjectModel,
) {
  const shapeOf = (componentId: string) =>
    componentById(model, componentId)?.appearances.find((a) => a.diagramId === diagramId)
      ?.elementId;
  const store = useElementsStore.getState();
  const from = store.elements.get(shapeOf(relationship.sourceId) ?? '');
  const to = store.elements.get(shapeOf(relationship.targetId) ?? '');
  if (!from || !to) return;
  const fromCopy = { ...from, boundElements: [...from.boundElements] };
  const toCopy = { ...to, boundElements: [...to.boundElements] };
  const arrow = connectElements(diagramId, fromCopy, toCopy);
  const created: MavisElement[] = [arrow];
  const text = relationship.labels[0] ?? relationship.technology;
  if (text) {
    const label = makeLabel(diagramId, arrow, text, 16);
    arrow.boundElements = [{ id: label.id, type: 'text' }];
    created.push(label);
  }
  store.pushHistory();
  useElementsStore.setState((prev) => {
    const next = new Map(prev.elements);
    for (const el of created) next.set(el.id, el);
    next.set(fromCopy.id, { ...fromCopy, version: fromCopy.version + 1, updatedAt: Date.now() });
    next.set(toCopy.id, { ...toCopy, version: toCopy.version + 1, updatedAt: Date.now() });
    return { elements: next };
  });
  scheduleModelRefresh();
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
/** The model is computed from saved diagrams: refresh after the autosave catches up. */
export function scheduleModelRefresh(delayMs = 2500) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void useModelStore.getState().refresh();
  }, delayMs);
}

/**
 * A label was just edited on the canvas or in the portal panel. If the shape's
 * component is drawn anywhere else (or opens into its own diagram), rename it
 * everywhere: the server relabels every appearance and retitles the diagram.
 */
export function renameEverywhere(elementId: string) {
  const { projectId, model } = useModelStore.getState();
  const elements = useElementsStore.getState().elements;
  const el = elements.get(elementId);
  if (!projectId || !model || !el) return;
  const name = getGivenLabel(el, elements);
  const key = componentKeyFor(el, name);
  if (!name || !key) return;
  // Not comparing with the model's name: it's what most labels say, so it
  // can already read the new name while other appearances still don't
  const component = componentById(model, key);
  if (!component) return scheduleModelRefresh();
  const elsewhere =
    component.appearances.some((a) => a.elementId !== elementId) || !!component.detailDiagramId;
  if (!elsewhere) return scheduleModelRefresh();
  // This tab already shows the new name here; keep its copy of the detail
  // diagram's title in step too (the server renames the rest)
  if (component.detailDiagramId) applyTitles([{ id: component.detailDiagramId, title: name }]);
  apiUpdateComponent(projectId, key, { name })
    .then(() => useModelStore.getState().refresh())
    .catch((err) => {
      console.warn('[model] rename failed:', err);
      toast('Renamed here only: couldn’t reach the server to rename it everywhere', 'error');
    });
}

/**
 * Titles the server changed (a rename): applied as already saved, so this tab
 * doesn't send them back as its own edit.
 */
export function applyTitles(titles: Array<{ id: string; title: string }>) {
  useDiagramStore.setState((prev) => {
    let next: Map<string, typeof prev.diagrams extends Map<string, infer D> ? D : never> | null =
      null;
    for (const { id, title } of titles) {
      const current = prev.diagrams.get(id);
      if (!current || current.title === title) continue;
      next ??= new Map(prev.diagrams);
      next.set(id, { ...current, title });
    }
    return next ? { diagrams: next } : prev;
  });
}

/** A room said diagrams changed (e.g. a rename retitled one): fetch the titles. */
export async function refreshDiagramTitles() {
  const projectId = useModelStore.getState().projectId;
  if (!projectId) return;
  try {
    const { diagrams } = await apiListDiagrams(projectId);
    applyTitles(diagrams.map((d) => ({ id: d.id, title: d.title })));
  } catch (err) {
    console.warn('[model] diagram titles refresh failed:', err);
  }
}

/**
 * Undo and redo change labels too: a component's name follows its label
 * whichever way it changed, so undoing a rename undoes it everywhere.
 */
export function shapesWhoseLabelChanged(
  changedIds: string[],
  elements: Map<string, MavisElement>,
): string[] {
  const shapes = new Set<string>();
  for (const id of changedIds) {
    const el = elements.get(id);
    if (!el || el.isDeleted) continue;
    if (el.type === 'text' && (el as TextElement).containerId) {
      shapes.add((el as TextElement).containerId!);
    } else if (el.type === 'portal') {
      shapes.add(el.id);
    }
  }
  return Array.from(shapes);
}

onHistoryApplied((changedIds) => {
  const elements = useElementsStore.getState().elements;
  for (const shapeId of shapesWhoseLabelChanged(changedIds, elements)) renameEverywhere(shapeId);
});

import type { MavisElement, Point } from '@mavisdraw/types';
import {
  useElementsStore,
  type ClipboardEnvelope,
  type ZOrderAction,
} from '../stores/elementsStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useDiagramStore } from '../stores/diagramStore';
import { useUIStore } from '../stores/uiStore';
import { useLayerStore } from '../stores/layerStore';
import { getCanvasController } from '../components/canvas/canvasController';
import { unionVisualBounds } from '../components/canvas/HitTesting';

/**
 * Editor commands shared by keyboard shortcuts, the context menu and (later)
 * the command palette, so every entry point behaves identically.
 */

function selectedIds(): string[] {
  return Array.from(useSelectionStore.getState().selectedIds);
}

function selectedElements(): MavisElement[] {
  const elements = useElementsStore.getState().elements;
  return selectedIds()
    .map((id) => elements.get(id))
    .filter((el): el is MavisElement => !!el && !el.isDeleted);
}

function pasteAnchor(): Point | undefined {
  return getCanvasController()?.getPasteAnchor();
}

/** Serialize the selection for the system clipboard (cross-tab paste). */
export function copySelection(): ClipboardEnvelope | null {
  const ids = selectedIds();
  if (ids.length === 0) return null;
  return useElementsStore.getState().copyElements(ids);
}

/** Best-effort write to the async clipboard API (menus can't use copy events). */
async function writeEnvelopeToSystemClipboard(envelope: ClipboardEnvelope | null): Promise<void> {
  if (!envelope) return;
  try {
    await navigator.clipboard?.writeText(JSON.stringify(envelope));
  } catch {
    // Permission denied or unsupported: the in-app clipboard still works
  }
}

export function copy(): void {
  void writeEnvelopeToSystemClipboard(copySelection());
}

export function cut(): void {
  const envelope = copySelection();
  if (!envelope) return;
  void writeEnvelopeToSystemClipboard(envelope);
  deleteSelection();
}

/** Paste the in-app clipboard at the pointer (or viewport center). */
/** Where the last paste went, and how many came after it in the same spot. */
let lastPaste: { x: number; y: number; repeats: number } | null = null;

/**
 * Pasting again without moving goes 20 screen px further each time, so each
 * copy can be seen (it used to land exactly on the last one).
 */
function steppedAnchor(at: Point | undefined): Point | undefined {
  if (!at) return at;
  if (lastPaste && Math.abs(lastPaste.x - at.x) < 1 && Math.abs(lastPaste.y - at.y) < 1) {
    lastPaste.repeats += 1;
  } else {
    lastPaste = { x: at.x, y: at.y, repeats: 0 };
  }
  const zoom = getCanvasController()?.getViewport?.().zoom ?? 1;
  const step = (20 / Math.max(0.1, zoom)) * lastPaste.repeats;
  return { x: at.x + step, y: at.y + step };
}

export function pasteInternal(at: Point | undefined = pasteAnchor()): MavisElement[] {
  const diagramId = useDiagramStore.getState().activeDiagramId;
  const pasted = useElementsStore.getState().pasteElements(diagramId, steppedAnchor(at));
  if (pasted.length > 0) {
    useSelectionStore.getState().selectMultiple(topLevelIds(pasted));
  }
  return pasted;
}

/** Paste from the system clipboard when allowed, falling back to the in-app clipboard. */
export async function paste(at: Point | undefined = pasteAnchor()): Promise<void> {
  try {
    const text = await navigator.clipboard?.readText();
    const envelope = text ? parseClipboardEnvelope(text) : null;
    if (envelope) useElementsStore.getState().setClipboardFromEnvelope(envelope);
  } catch {
    // Reading the clipboard needs permission; the in-app clipboard is fine
  }
  pasteInternal(at);
}

export function parseClipboardEnvelope(text: string): ClipboardEnvelope | null {
  if (!text.includes('mavisdraw-clipboard')) return null;
  try {
    const parsed = JSON.parse(text) as Partial<ClipboardEnvelope>;
    if (parsed.type === 'mavisdraw-clipboard' && Array.isArray(parsed.elements)) {
      return parsed as ClipboardEnvelope;
    }
  } catch {
    // Not ours
  }
  return null;
}

/** Labels are selected along with their shape; don't list them separately. */
function topLevelIds(elements: MavisElement[]): string[] {
  const ids = new Set(elements.map((el) => el.id));
  return elements
    .filter((el) => !(el.type === 'text' && el.containerId && ids.has(el.containerId)))
    .map((el) => el.id);
}

export function duplicate(): void {
  const ids = selectedIds();
  if (ids.length === 0) return;
  const created = useElementsStore.getState().duplicateElements(ids);
  if (created.length > 0) useSelectionStore.getState().selectMultiple(topLevelIds(created));
}

/** Gap left between the selection and a copy placed beside it (Alt+Arrow). */
export const DUPLICATE_BESIDE_GAP = 40;

/**
 * Alt+Arrow (Miro): copy the selection and put the copy right next to it in
 * that direction — the fast way to lay out a row or column of services.
 */
export function duplicateBeside(direction: { x: -1 | 0 | 1; y: -1 | 0 | 1 }): void {
  const ids = selectedIds();
  const elements = selectedElements();
  if (ids.length === 0 || elements.length === 0) return;
  const bounds = unionVisualBounds(elements);
  if (!bounds) return;
  const offset = {
    x: direction.x * (bounds.width + DUPLICATE_BESIDE_GAP),
    y: direction.y * (bounds.height + DUPLICATE_BESIDE_GAP),
  };
  const created = useElementsStore.getState().duplicateElements(ids, offset);
  if (created.length > 0) useSelectionStore.getState().selectMultiple(topLevelIds(created));
  getCanvasController()?.invalidate();
}

export function deleteSelection(): void {
  const ids = selectedIds();
  if (ids.length === 0) return;
  useElementsStore.getState().deleteElements(ids);
  useSelectionStore.getState().clearSelection();
}

/**
 * Everything you could click on: not what's on hidden or locked layers, and
 * not locked shapes (Excalidraw). Ctrl/Cmd+A then Delete deleted shapes on
 * hidden layers, and one locked shape took the handles off everything.
 */
export function selectAll(): void {
  const diagramId = useDiagramStore.getState().activeDiagramId;
  const layers = useLayerStore.getState().layers;
  const known = new Set(layers.map((l) => l.id));
  const offLimits = new Set(layers.filter((l) => !l.isVisible || l.isLocked).map((l) => l.id));
  const ids: string[] = [];
  for (const el of useElementsStore.getState().elements.values()) {
    if (el.isDeleted || el.diagramId !== diagramId || el.isLocked) continue;
    if (known.has(el.layerId) && offLimits.has(el.layerId)) continue;
    if (el.type === 'text' && el.containerId) continue;
    ids.push(el.id);
  }
  useSelectionStore.getState().selectAll(ids);
}

export function reorder(action: ZOrderAction): void {
  useElementsStore.getState().reorderElements(selectedIds(), action);
}

export function group(): void {
  const ids = selectedIds();
  if (ids.length >= 2) useElementsStore.getState().groupElements(ids);
}

export function ungroup(): void {
  const ids = selectedIds();
  if (ids.length > 0) useElementsStore.getState().ungroupElements(ids);
}

export function isSelectionLocked(): boolean {
  const els = selectedElements();
  return els.length > 0 && els.every((el) => el.isLocked);
}

export function toggleLock(): void {
  const ids = selectedIds();
  if (ids.length === 0) return;
  useElementsStore.getState().setElementsLocked(ids, !isSelectionLocked());
}

export function canGroup(): boolean {
  return selectedIds().length >= 2;
}

export function canUngroup(): boolean {
  return selectedElements().some((el) => el.groupIds.length > 0);
}

export async function copySelectionAsPng(): Promise<boolean> {
  const els = selectedElements();
  const diagramId = useDiagramStore.getState().activeDiagramId;
  const elements = useElementsStore.getState().elements;
  // Labels of selected shapes are part of the picture
  const ids = new Set(els.map((e) => e.id));
  for (const el of els) {
    for (const b of el.boundElements) if (b.type === 'text') ids.add(b.id);
  }
  const toRender =
    els.length > 0
      ? Array.from(ids)
          .map((id) => elements.get(id))
          .filter((el): el is MavisElement => !!el && !el.isDeleted)
      : Array.from(elements.values()).filter((el) => el.diagramId === diagramId && !el.isDeleted);
  if (toRender.length === 0) return false;
  const { copyElementsAsPng } = await import('../utils/exportImage');
  return copyElementsAsPng(toRender, useUIStore.getState().renderMode);
}

export function zoomToFit(): void {
  getCanvasController()?.zoomToFit();
}

export function zoomToSelection(): void {
  getCanvasController()?.zoomToSelection();
}

/**
 * Auto-arrange the selection (2+ shapes) or the whole diagram along its
 * connections, as one undoable step.
 */
export async function tidyUp(): Promise<void> {
  const { tidyUpDiagram } = await import('../layout/autoLayout');
  const diagramId = useDiagramStore.getState().activeDiagramId;
  const ids = selectedIds();
  const changed = await tidyUpDiagram(diagramId, ids.length >= 2 ? new Set(ids) : undefined);
  if (changed) {
    getCanvasController()?.invalidate();
    if (ids.length < 2) getCanvasController()?.zoomToFit();
  }
}

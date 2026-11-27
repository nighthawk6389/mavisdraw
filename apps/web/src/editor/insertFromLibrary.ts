import { PROVIDERS, type CatalogEntry } from '@mavisdraw/export/library';
import type { MavisElement, RectangleElement } from '@mavisdraw/types';
import { useElementsStore } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';
import { useSelectionStore } from '../stores/selectionStore';
import { getCanvasController } from '../components/canvas/canvasController';
import { defaultShapeSize } from '../components/canvas/gestures/transform';
import { makeLabel } from './elementFactory';

/**
 * Put a library entry on the canvas (at the centre of the view, or `at`):
 * its shape, with its icon and label, in its provider's colour. One undo
 * step; the new shape is selected. Returns its id.
 */
export function insertFromLibrary(entry: CatalogEntry, at?: { x: number; y: number }): string {
  const store = useElementsStore.getState();
  const diagramId = useDiagramStore.getState().activeDiagramId;
  const center = at ?? getCanvasController()?.getPasteAnchor() ?? { x: 0, y: 0 };
  const { width, height } = defaultShapeSize(entry.shape);
  const spot = freeSpot(
    diagramId,
    { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2) },
    width,
    height,
  );
  const shape = store.createElement(
    entry.shape,
    diagramId,
    spot.x,
    spot.y,
    width,
    height,
  ) as MavisElement;
  shape.icon = entry.icon;
  if (entry.provider !== 'generic') shape.strokeColor = PROVIDERS[entry.provider].color;
  if (shape.type === 'rectangle') (shape as RectangleElement).roundness = 8;
  const label = makeLabel(diagramId, shape, entry.name, 20);
  shape.boundElements = [{ id: label.id, type: 'text' }];

  store.pushHistory();
  useElementsStore.setState((prev) => {
    const next = new Map(prev.elements);
    next.set(shape.id, shape);
    next.set(label.id, label);
    return { elements: next };
  });
  useSelectionStore.getState().select(shape.id);
  return shape.id;
}

/**
 * Where a new shape of this size goes: the first spot from `start` that
 * overlaps nothing on the diagram, stepping right, then down a row (so
 * several picks in a row don't land on top of each other).
 */
export function freeSpot(
  diagramId: string,
  start: { x: number; y: number },
  width: number,
  height: number,
): { x: number; y: number } {
  const gap = 40;
  // Boxes (lines can have negative sizes); labels sit inside their shapes
  const others = Array.from(useElementsStore.getState().elements.values())
    .filter((e) => e.diagramId === diagramId && !e.isDeleted && e.type !== 'text')
    .map((e) => ({
      x: Math.min(e.x, e.x + e.width),
      y: Math.min(e.y, e.y + e.height),
      w: Math.abs(e.width),
      h: Math.abs(e.height),
    }));
  const overlaps = (x: number, y: number) =>
    others.some(
      (e) =>
        x < e.x + e.w + gap / 2 &&
        x + width + gap / 2 > e.x &&
        y < e.y + e.h + gap / 2 &&
        y + height + gap / 2 > e.y,
    );
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 6; col++) {
      const x = start.x + col * (width + gap);
      const y = start.y + row * (height + gap);
      if (!overlaps(x, y)) return { x, y };
    }
  }
  return start;
}

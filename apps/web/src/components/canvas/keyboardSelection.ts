import type { MavisElement } from '@mavisdraw/types';
import { labelFor } from '../../services/modelSync';

/** Shapes Tab moves between: everything on the diagram except labels (they go with their shape). */
export function tabbableShapes(elements: MavisElement[]): MavisElement[] {
  return elements.filter((el) => !el.isDeleted && !(el.type === 'text' && el.containerId));
}

/**
 * Where Tab (or Shift+Tab) goes from the current selection: the next shape
 * in stacking order, or null to leave the canvas (past the last one, so a
 * keyboard user is never trapped in it).
 */
export function nextTabStop(
  shapes: MavisElement[],
  selected: ReadonlySet<string>,
  backwards: boolean,
): string | null {
  if (shapes.length === 0) return null;
  const at = shapes.findIndex((el) => selected.has(el.id));
  if (at === -1) return backwards ? shapes[shapes.length - 1].id : shapes[0].id;
  const next = at + (backwards ? -1 : 1);
  return next >= 0 && next < shapes.length ? shapes[next].id : null;
}

const TYPE_NAMES: Record<string, string> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  cylinder: 'Datastore',
  queue: 'Queue',
  line: 'Line',
  arrow: 'Arrow',
  freedraw: 'Drawing',
  text: 'Text',
  portal: 'Nested diagram',
  image: 'Image',
  triangle: 'Triangle',
};

/** What a screen reader says about the selection ("Rectangle “API” selected"). */
export function describeSelection(
  elements: Map<string, MavisElement>,
  selected: ReadonlySet<string>,
): string {
  if (selected.size === 0) return '';
  if (selected.size > 1) return `${selected.size} shapes selected`;
  const [id] = Array.from(selected);
  const el = elements.get(id);
  if (!el) return '';
  const kind = TYPE_NAMES[el.type] ?? 'Shape';
  const label = el.type === 'text' ? (el as { text?: string }).text : labelFor(elements, id);
  const short = label ? label.trim().slice(0, 80) : '';
  return short ? `${kind} “${short}” selected` : `${kind} selected`;
}

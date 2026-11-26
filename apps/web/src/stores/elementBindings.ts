import type { LinearElement, MavisElement, Point, TextElement } from '@mavisdraw/types';

/**
 * Pure helpers that keep relationships between elements consistent:
 * labels (bound text) inside their shapes, arrow endpoints on the shapes
 * they're bound to, and back-references cleaned up on delete.
 *
 * All functions mutate the `next` map passed in (a fresh copy owned by the
 * caller's `set()` call) and never touch store state directly.
 */

/** Padding between a container's edge and its bound label. */
export const BOUND_TEXT_PADDING = 10;

const CONTAINER_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'triangle', 'portal', 'image']);

export function isLinear(el: MavisElement): el is LinearElement {
  return el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw';
}

export function isContainer(el: MavisElement): boolean {
  return CONTAINER_TYPES.has(el.type);
}

/** The box a bound label should occupy inside its container. */
export function boundTextBox(container: MavisElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: container.x + BOUND_TEXT_PADDING,
    y: container.y + BOUND_TEXT_PADDING,
    width: Math.max(20, container.width - BOUND_TEXT_PADDING * 2),
    height: Math.max(20, container.height - BOUND_TEXT_PADDING * 2),
  };
}

function bump<T extends MavisElement>(el: T, changes: Partial<T>): T {
  return { ...el, ...changes, version: el.version + 1, updatedAt: Date.now() };
}

/**
 * Point on an element's outline in the direction of (fromX, fromY), pushed
 * out by `gap`. Used to keep bound arrow endpoints glued to shapes.
 */
export function getBindingEdgePoint(
  element: MavisElement,
  fromX: number,
  fromY: number,
  gap: number,
): Point {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const angle = Math.atan2(fromY - cy, fromX - cx);

  switch (element.type) {
    case 'ellipse': {
      const rx = element.width / 2 + gap;
      const ry = element.height / 2 + gap;
      return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
    }
    case 'diamond': {
      const hw = element.width / 2 + gap;
      const hh = element.height / 2 + gap;
      const denom = Math.abs(Math.cos(angle)) / hw + Math.abs(Math.sin(angle)) / hh;
      if (denom === 0) return { x: cx, y: cy };
      const r = 1 / denom;
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    }
    default: {
      const hw = element.width / 2 + gap;
      const hh = element.height / 2 + gap;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      if (cosA === 0) return { x: cx, y: cy + (sinA > 0 ? hh : -hh) };
      if (sinA === 0) return { x: cx + (cosA > 0 ? hw : -hw), y: cy };
      const t = Math.min(hw / Math.abs(cosA), hh / Math.abs(sinA));
      return { x: cx + t * cosA, y: cy + t * sinA };
    }
  }
}

/**
 * After a container moved or resized, re-fit its label and re-glue every
 * arrow bound to it. Safe to call for any element id; no-ops otherwise.
 */
export function syncBoundElements(next: Map<string, MavisElement>, id: string): void {
  const shape = next.get(id);
  if (!shape || shape.isDeleted || isLinear(shape) || shape.type === 'text') return;
  if (!shape.boundElements || shape.boundElements.length === 0) return;

  for (const bound of shape.boundElements) {
    const el = next.get(bound.id);
    if (!el || el.isDeleted) continue;

    if (el.type === 'text') {
      const text = el as TextElement;
      if (text.containerId !== id) continue;
      const box = boundTextBox(shape);
      if (
        text.x !== box.x ||
        text.y !== box.y ||
        text.width !== box.width ||
        text.height !== box.height
      ) {
        next.set(text.id, bump(text, box));
      }
      continue;
    }

    if (el.type === 'arrow' || el.type === 'line') {
      const arrow = el as LinearElement;
      const points = arrow.points.map((p) => [...p] as [number, number]);
      let changed = false;

      if (arrow.startBinding?.elementId === id && points.length >= 2) {
        const other = points[points.length - 1];
        const edge = getBindingEdgePoint(
          shape,
          arrow.x + other[0],
          arrow.y + other[1],
          arrow.startBinding.gap,
        );
        points[0] = [edge.x - arrow.x, edge.y - arrow.y];
        changed = true;
      }
      if (arrow.endBinding?.elementId === id && points.length >= 2) {
        const other = points[0];
        const edge = getBindingEdgePoint(
          shape,
          arrow.x + other[0],
          arrow.y + other[1],
          arrow.endBinding.gap,
        );
        points[points.length - 1] = [edge.x - arrow.x, edge.y - arrow.y];
        changed = true;
      }
      if (changed) next.set(arrow.id, bump(arrow, { points }));
    }
  }
}

/**
 * Soft-delete `ids` plus everything that can't live without them (labels
 * inside deleted shapes), and clean up every reference to the deleted
 * elements so nothing points at a ghost. Locked elements are skipped.
 * Returns the ids that were actually deleted.
 */
export function cascadeDelete(next: Map<string, MavisElement>, ids: Iterable<string>): Set<string> {
  const toDelete = new Set<string>();
  for (const id of ids) {
    const el = next.get(id);
    if (!el || el.isDeleted || el.isLocked) continue;
    toDelete.add(id);
    for (const bound of el.boundElements ?? []) {
      if (bound.type === 'text') toDelete.add(bound.id);
    }
  }

  for (const id of toDelete) {
    const el = next.get(id);
    if (!el || el.isDeleted) {
      toDelete.delete(id);
      continue;
    }
    next.set(id, bump(el, { isDeleted: true }));
  }

  for (const id of toDelete) {
    const el = next.get(id)!;

    // Arrow deleted: drop it from the shapes it was attached to.
    if (el.type === 'arrow' || el.type === 'line') {
      const arrow = el as LinearElement;
      for (const binding of [arrow.startBinding, arrow.endBinding]) {
        if (!binding) continue;
        removeBackReference(next, binding.elementId, id, toDelete);
      }
    }

    // Label deleted on its own: detach it from its container.
    if (el.type === 'text') {
      const containerId = (el as TextElement).containerId;
      if (containerId) removeBackReference(next, containerId, id, toDelete);
    }

    // Shape deleted: arrows that pointed at it become free-standing.
    for (const bound of el.boundElements ?? []) {
      if (bound.type !== 'arrow' && bound.type !== 'line') continue;
      if (toDelete.has(bound.id)) continue;
      const arrow = next.get(bound.id) as LinearElement | undefined;
      if (!arrow || arrow.isDeleted) continue;
      next.set(
        arrow.id,
        bump(arrow, {
          startBinding: arrow.startBinding?.elementId === id ? null : arrow.startBinding,
          endBinding: arrow.endBinding?.elementId === id ? null : arrow.endBinding,
        }),
      );
    }
  }

  return toDelete;
}

function removeBackReference(
  next: Map<string, MavisElement>,
  ownerId: string,
  refId: string,
  deleting: Set<string>,
): void {
  if (deleting.has(ownerId)) return;
  const owner = next.get(ownerId);
  if (!owner || owner.isDeleted) return;
  if (!owner.boundElements.some((b) => b.id === refId)) return;
  next.set(
    ownerId,
    bump(owner, { boundElements: owner.boundElements.filter((b) => b.id !== refId) }),
  );
}

/** Ids of labels bound inside the given containers (for copy/duplicate). */
export function withBoundLabels(
  elements: Map<string, MavisElement>,
  ids: Iterable<string>,
): string[] {
  const result = new Set<string>();
  for (const id of ids) {
    const el = elements.get(id);
    if (!el || el.isDeleted) continue;
    result.add(id);
    for (const bound of el.boundElements ?? []) {
      if (bound.type !== 'text') continue;
      const label = elements.get(bound.id);
      if (label && !label.isDeleted) result.add(bound.id);
    }
  }
  return Array.from(result);
}

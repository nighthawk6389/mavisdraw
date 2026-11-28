import type { LinearElement, MavisElement, Point, TextElement } from '@mavisdraw/types';
import { facingSides, sideMidpoint } from '@mavisdraw/math';

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

const CONTAINER_TYPES = new Set([
  'rectangle',
  'ellipse',
  'diamond',
  'triangle',
  'cylinder',
  'queue',
  'portal',
  'image',
]);

export function isLinear(el: MavisElement): el is LinearElement {
  return el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw';
}

export function isContainer(el: MavisElement): boolean {
  return CONTAINER_TYPES.has(el.type);
}

/** Default size of a connector label box before its text is measured. */
export const ARROW_LABEL_DEFAULT = { width: 120, height: 24 };

/**
 * Point halfway along a linear element's polyline (world coordinates).
 * The renderer refines this for curved/elbow routes; this is what's stored
 * so hit-testing and exports place the label sensibly.
 */
export function linearMidpoint(el: LinearElement): Point {
  const pts = el.points;
  if (pts.length === 0) return { x: el.x, y: el.y };
  if (pts.length === 1) return { x: el.x + pts[0][0], y: el.y + pts[0][1] };
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  let remaining = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (remaining <= seg && seg > 0) {
      const t = remaining / seg;
      return {
        x: el.x + pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
        y: el.y + pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
      };
    }
    remaining -= seg;
  }
  const last = pts[pts.length - 1];
  return { x: el.x + last[0], y: el.y + last[1] };
}

/** The box a bound label should occupy inside its container. */
export function boundTextBox(
  container: MavisElement,
  size: { width: number; height: number } = ARROW_LABEL_DEFAULT,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (isLinear(container)) {
    // Connector labels sit centred on the connector's midpoint
    const mid = linearMidpoint(container);
    return {
      x: mid.x - size.width / 2,
      y: mid.y - size.height / 2,
      width: size.width,
      height: size.height,
    };
  }
  // The rectangle that fits inside the shape, less a padding: a label in an
  // ellipse or a diamond keeps clear of its curve or corners
  const k = labelBoxScale(container.type);
  const pad = labelPadding(container.type);
  const w = container.width * k;
  const h = container.height * k;
  return {
    x: container.x + (container.width - w) / 2 + pad,
    y: container.y + (container.height - h) / 2 + pad,
    width: Math.max(20, w - pad * 2),
    height: Math.max(20, h - pad * 2),
  };
}

/** The share of a shape's box (each way) its label can use. */
function labelBoxScale(type: MavisElement['type']): number {
  if (type === 'ellipse') return Math.SQRT1_2;
  if (type === 'diamond') return 0.5;
  return 1;
}

const labelPadding = (type: MavisElement['type']) =>
  labelBoxScale(type) === 1 ? BOUND_TEXT_PADDING : BOUND_TEXT_PADDING / 2;

/**
 * How tall a shape has to be for a label `labelHeight` tall to fit inside it
 * (no shorter than it already is): shapes grow to fit their labels rather
 * than letting them spill out (Excalidraw, tldraw).
 */
export function containerHeightForLabel(container: MavisElement, labelHeight: number): number {
  const needed = (labelHeight + labelPadding(container.type) * 2) / labelBoxScale(container.type);
  return Math.max(container.height, Math.ceil(needed));
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
  if (element.angle) {
    // Work in the shape's own frame, then turn the result back with it
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const cos = Math.cos(element.angle);
    const sin = Math.sin(element.angle);
    const dx = fromX - cx;
    const dy = fromY - cy;
    const local = getBindingEdgePoint(
      { ...element, angle: 0 },
      cx + dx * cos + dy * sin,
      cy - dx * sin + dy * cos,
      gap,
    );
    const lx = local.x - cx;
    const ly = local.y - cy;
    return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
  }
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
  if (!shape || shape.isDeleted || shape.type === 'text') return;
  if (!shape.boundElements || shape.boundElements.length === 0) return;

  if (isLinear(shape)) {
    syncConnectorLabels(next, shape);
    return;
  }

  for (const bound of shape.boundElements) {
    const el = next.get(bound.id);
    if (!el || el.isDeleted) continue;

    if (el.type === 'text') {
      const text = el as TextElement;
      if (text.containerId !== id) continue;
      const box = boundTextBox(shape);
      // The label shares the shape's centre, so turning it by the same angle keeps it inside
      const angle = shape.angle ?? 0;
      if (
        text.x !== box.x ||
        text.y !== box.y ||
        text.width !== box.width ||
        text.height !== box.height ||
        (text.angle ?? 0) !== angle
      ) {
        next.set(text.id, bump(text, { ...box, angle }));
      }
      continue;
    }

    if (el.type === 'arrow' || el.type === 'line') {
      glueEndpoints(next, el as LinearElement, (targetId) => (targetId === id ? shape : null), true);
    }
  }
}

/**
 * Put an arrow's bound endpoints back on the outline of the shapes they're
 * bound to. `targetFor` picks which bindings to honour. With `always`, the
 * arrow is rewritten even when nothing moved (the historical behaviour of
 * `syncBoundElements`); otherwise only when an endpoint actually changed.
 */
function glueEndpoints(
  next: Map<string, MavisElement>,
  arrow: LinearElement,
  targetFor: (targetId: string) => MavisElement | null,
  always: boolean,
): void {
  if (arrow.points.length < 2) return;
  const points = arrow.points.map((p) => [...p] as [number, number]);
  let glued = false;
  let moved = false;
  const place = (index: number, otherIndex: number, target: MavisElement, gap: number) => {
    const other = points[otherIndex];
    const edge = getBindingEdgePoint(target, arrow.x + other[0], arrow.y + other[1], gap);
    const value: [number, number] = [edge.x - arrow.x, edge.y - arrow.y];
    if (value[0] !== points[index][0] || value[1] !== points[index][1]) moved = true;
    points[index] = value;
    glued = true;
  };
  const last = points.length - 1;
  const start = arrow.startBinding ? targetFor(arrow.startBinding.elementId) : null;
  const end = arrow.endBinding ? targetFor(arrow.endBinding.elementId) : null;
  // An auto-routed elbow connector leaves and arrives through the sides that
  // face each other, so its route runs between the shapes, not through them
  const autoElbow =
    arrow.routingMode === 'elbow' && !(arrow.elbowManualRoute && points.length > 2);
  // Which sides face depends on both shapes, and either end can change side
  // when one of them moves: both are looked up, whichever one moved
  const shapeOf = (binding: LinearElement['startBinding']) => {
    const el = binding ? next.get(binding.elementId) : undefined;
    return el && !el.isDeleted && el.type !== 'text' ? el : null;
  };
  const startShape = autoElbow && (start || end) ? shapeOf(arrow.startBinding) : null;
  const endShape = autoElbow && (start || end) ? shapeOf(arrow.endBinding) : null;
  if (autoElbow && (startShape || endShape) && !startShape?.angle && !endShape?.angle) {
    const looseEnd = (index: number) => ({
      x: arrow.x + points[index][0],
      y: arrow.y + points[index][1],
      width: 0,
      height: 0,
    });
    const [fromSide, toSide] = facingSides(startShape ?? looseEnd(0), endShape ?? looseEnd(last));
    const put = (index: number, value: [number, number]) => {
      const local: [number, number] = [value[0] - arrow.x, value[1] - arrow.y];
      if (local[0] !== points[index][0] || local[1] !== points[index][1]) moved = true;
      points[index] = local;
      glued = true;
    };
    if (startShape && arrow.startBinding) {
      put(0, sideMidpoint(startShape, fromSide, arrow.startBinding.gap));
    }
    if (endShape && arrow.endBinding) put(last, sideMidpoint(endShape, toSide, arrow.endBinding.gap));
  } else {
    // Each end aims at its neighbouring point: a bent connector keeps the
    // side it leaves from (for a straight one that's the other end)
    if (start && arrow.startBinding) place(0, 1, start, arrow.startBinding.gap);
    if (end && arrow.endBinding) place(last, last - 1, end, arrow.endBinding.gap);
  }
  if (glued && (always || moved)) {
    const updated = bump(arrow, { points });
    next.set(arrow.id, updated);
    syncConnectorLabels(next, updated);
  }
}

/**
 * After an arrow itself moved (dragged along with a selection), keep its
 * bound ends attached to their shapes — including shapes that stayed put —
 * so connectors stretch instead of detaching (Miro/tldraw behaviour).
 */
export function reglueArrowEndpoints(next: Map<string, MavisElement>, arrowId: string): void {
  const arrow = next.get(arrowId);
  if (!arrow || arrow.isDeleted || (arrow.type !== 'arrow' && arrow.type !== 'line')) return;
  glueEndpoints(
    next,
    arrow as LinearElement,
    (targetId) => {
      const target = next.get(targetId);
      return target && !target.isDeleted && target.type !== 'text' ? target : null;
    },
    false,
  );
}

/** Keep a connector's labels centred on it (their size is kept). */
function syncConnectorLabels(next: Map<string, MavisElement>, connector: LinearElement): void {
  for (const bound of connector.boundElements) {
    if (bound.type !== 'text') continue;
    const label = next.get(bound.id);
    if (!label || label.isDeleted || label.type !== 'text' || label.containerId !== connector.id) {
      continue;
    }
    const box = boundTextBox(connector, { width: label.width, height: label.height });
    if (label.x !== box.x || label.y !== box.y) {
      next.set(label.id, bump(label, { x: box.x, y: box.y }));
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

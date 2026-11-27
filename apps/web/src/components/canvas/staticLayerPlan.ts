import type { LinearElement, MavisElement, TextElement } from '@mavisdraw/types';

/**
 * Deciding how little of the static layer to redraw. During a drag (or any
 * edit that touches a few shapes) only those shapes change between frames:
 * everything below them and everything above them can be kept as two
 * bitmaps, and only the span in between is drawn again, in stacking order.
 */

/** Up to this many changing shapes, keep the rest as bitmaps. */
export const MAX_LIVE_CHANGES = 300;
/** Above this many shapes between the lowest and highest changing one, draw it all. */
export const MAX_LIVE_SPAN = 600;

/**
 * Which elements look different from last frame, given the draw list of
 * both (in stacking order). Null when the list itself changed (an element
 * added, removed or restacked): then everything is drawn.
 *
 * An element counts as changed when its object did, or when what it's
 * drawn from did: a connector follows the shapes it's bound to (elbow
 * routes are computed while drawing), a connector's label follows the
 * connector.
 */
export function changedSince(
  prev: readonly MavisElement[] | null,
  next: readonly MavisElement[],
): Set<string> | null {
  if (!prev || prev.length !== next.length) return null;
  const changed = new Set<string>();
  for (let i = 0; i < next.length; i++) {
    if (prev[i].id !== next[i].id) return null;
    if (prev[i] !== next[i]) changed.add(next[i].id);
  }
  if (changed.size === 0) return changed;
  // Connectors bound to something that changed
  for (const el of next) {
    if (el.type !== 'arrow' && el.type !== 'line') continue;
    const linear = el as LinearElement;
    const start = linear.startBinding?.elementId;
    const end = linear.endBinding?.elementId;
    if ((start && changed.has(start)) || (end && changed.has(end))) changed.add(el.id);
  }
  // Labels of connectors that changed
  for (const el of next) {
    const container = el.type === 'text' ? (el as TextElement).containerId : null;
    if (container && changed.has(container)) changed.add(el.id);
  }
  return changed;
}

export interface LivePlan {
  /** Index of the lowest element drawn live. */
  from: number;
  /** Index of the highest element drawn live. */
  to: number;
}

/**
 * The span of the draw list to draw live, given the elements that are
 * changing (null: draw everything this frame).
 */
export function liveSpan(list: readonly MavisElement[], hot: ReadonlySet<string>): LivePlan | null {
  if (hot.size === 0 || hot.size > MAX_LIVE_CHANGES) return null;
  let from = Infinity;
  let to = -Infinity;
  for (let i = 0; i < list.length; i++) {
    if (!hot.has(list[i].id)) continue;
    if (i < from) from = i;
    if (i > to) to = i;
  }
  if (from === Infinity) return null;
  if (to - from + 1 > MAX_LIVE_SPAN) return null;
  return { from, to };
}

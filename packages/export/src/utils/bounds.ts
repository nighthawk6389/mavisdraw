import type { Bounds, MavisElement } from '@mavisdraw/types';

/**
 * Compute the axis-aligned bounding box enclosing all elements.
 * Linear elements (lines, arrows, freedraw) are measured from their points,
 * which can extend left/up of the element origin, so exports don't clip them.
 * Returns null if the array is empty.
 */
export function computeElementsBounds(elements: MavisElement[]): Bounds | null {
  if (elements.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const include = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const el of elements) {
    if (
      (el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw') &&
      el.points.length > 0
    ) {
      for (const [px, py] of el.points) include(el.x + px, el.y + py);
    } else {
      include(el.x, el.y);
      include(el.x + el.width, el.y + el.height);
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

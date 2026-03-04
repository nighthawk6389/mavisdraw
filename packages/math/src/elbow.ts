/**
 * Elbow (orthogonal) arrow routing utilities.
 *
 * Provides anchor-aware routing so that arrows departing from a known
 * side of a shape move in the correct direction first, instead of
 * relying solely on dx/dy heuristics.
 */

export type ConnectionSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * Determine which side of a bounding box a point is on by finding the
 * nearest edge.
 *
 * @param px - Point x (absolute)
 * @param py - Point y (absolute)
 * @param x  - Bounding box top-left x
 * @param y  - Bounding box top-left y
 * @param width  - Bounding box width
 * @param height - Bounding box height
 */
export function getConnectionSide(
  px: number,
  py: number,
  x: number,
  y: number,
  width: number,
  height: number,
): ConnectionSide {
  const distTop = Math.abs(py - y);
  const distBottom = Math.abs(py - (y + height));
  const distLeft = Math.abs(px - x);
  const distRight = Math.abs(px - (x + width));

  const min = Math.min(distTop, distBottom, distLeft, distRight);

  if (min === distTop) return 'top';
  if (min === distBottom) return 'bottom';
  if (min === distLeft) return 'left';
  return 'right';
}

/** Margin (in local coords) to depart/approach from a shape side. */
const MARGIN = 20;
const ALIGN_THRESHOLD = 5;

/**
 * Calculate orthogonal (elbow) routing points between start and end.
 *
 * When direction hints are provided (from getConnectionSide), the route
 * departs `MARGIN` pixels in `startDir` and approaches `MARGIN` pixels
 * from `endDir`, then connects with an L-bend.
 *
 * Without direction hints, falls back to the legacy midpoint heuristic.
 *
 * @param start    - Start point [x, y] (local or absolute, must match end)
 * @param end      - End point [x, y]
 * @param startDir - Direction the arrow should depart from the start shape
 * @param endDir   - Direction the arrow should approach the end shape
 * @returns Array of [x, y] waypoints including start and end.
 */
export function calculateElbowRoute(
  start: [number, number],
  end: [number, number],
  startDir?: ConnectionSide | null,
  endDir?: ConnectionSide | null,
): [number, number][] {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];

  // Nearly aligned — straight line
  if (Math.abs(dx) < ALIGN_THRESHOLD && Math.abs(dy) < ALIGN_THRESHOLD) {
    return [start, end];
  }
  if (Math.abs(dx) < ALIGN_THRESHOLD) {
    return [start, end];
  }
  if (Math.abs(dy) < ALIGN_THRESHOLD) {
    return [start, end];
  }

  // ── Direction-aware routing ──────────────────────────────────

  if (startDir && endDir) {
    return routeBothDirections(start, end, startDir, endDir);
  }
  if (startDir) {
    return routeStartDirection(start, end, startDir);
  }
  if (endDir) {
    return routeEndDirection(start, end, endDir);
  }

  // ── Fallback heuristic (no bindings) ─────────────────────────

  if (Math.abs(dx) > Math.abs(dy)) {
    const midX = start[0] + dx / 2;
    return [start, [midX, start[1]], [midX, end[1]], end];
  } else {
    const midY = start[1] + dy / 2;
    return [start, [start[0], midY], [end[0], midY], end];
  }
}

// ── Internal helpers ──────────────────────────────────────────────

function departPoint(pt: [number, number], dir: ConnectionSide): [number, number] {
  switch (dir) {
    case 'top':
      return [pt[0], pt[1] - MARGIN];
    case 'bottom':
      return [pt[0], pt[1] + MARGIN];
    case 'left':
      return [pt[0] - MARGIN, pt[1]];
    case 'right':
      return [pt[0] + MARGIN, pt[1]];
  }
}

function isVertical(dir: ConnectionSide): boolean {
  return dir === 'top' || dir === 'bottom';
}

function routeBothDirections(
  start: [number, number],
  end: [number, number],
  startDir: ConnectionSide,
  endDir: ConnectionSide,
): [number, number][] {
  const depart = departPoint(start, startDir);
  const approach = departPoint(end, endDir);

  if (isVertical(startDir) && isVertical(endDir)) {
    // Both vertical: depart vertically, go horizontal, approach vertically
    const midY = (depart[1] + approach[1]) / 2;
    return [
      start,
      depart,
      [depart[0], midY],
      [approach[0], midY],
      approach,
      end,
    ];
  }

  if (!isVertical(startDir) && !isVertical(endDir)) {
    // Both horizontal: depart horizontally, go vertical, approach horizontally
    const midX = (depart[0] + approach[0]) / 2;
    return [
      start,
      depart,
      [midX, depart[1]],
      [midX, approach[1]],
      approach,
      end,
    ];
  }

  // Mixed: one vertical, one horizontal — L-bend through corner
  if (isVertical(startDir)) {
    // Start goes vertical, end goes horizontal
    const corner: [number, number] = [depart[0], approach[1]];
    return [start, depart, corner, approach, end];
  } else {
    // Start goes horizontal, end goes vertical
    const corner: [number, number] = [approach[0], depart[1]];
    return [start, depart, corner, approach, end];
  }
}

function routeStartDirection(
  start: [number, number],
  end: [number, number],
  startDir: ConnectionSide,
): [number, number][] {
  const depart = departPoint(start, startDir);

  if (isVertical(startDir)) {
    // Depart vertically, then go horizontal to end
    return [start, depart, [end[0], depart[1]], end];
  } else {
    // Depart horizontally, then go vertical to end
    return [start, depart, [depart[0], end[1]], end];
  }
}

// ── Segment manipulation helpers ─────────────────────────────────

export type SegmentOrientation = 'horizontal' | 'vertical' | 'diagonal';

/**
 * Determine the orientation of a segment between two points.
 */
export function getSegmentOrientation(
  a: [number, number],
  b: [number, number],
  threshold: number = 1,
): SegmentOrientation {
  if (Math.abs(a[1] - b[1]) < threshold) return 'horizontal';
  if (Math.abs(a[0] - b[0]) < threshold) return 'vertical';
  return 'diagonal';
}

/**
 * Apply a constrained drag to an elbow route segment.
 * Moving a horizontal segment shifts both endpoints' Y by delta.
 * Moving a vertical segment shifts both endpoints' X by delta.
 * Adjacent segments auto-adjust because they share endpoints.
 *
 * @param points - Current elbow route points
 * @param segmentIndex - Which segment (0-based) is being dragged
 * @param delta - Perpendicular displacement (deltaY for horizontal, deltaX for vertical)
 * @returns New points array with segment moved
 */
export function applyElbowSegmentDrag(
  points: [number, number][],
  segmentIndex: number,
  delta: number,
): [number, number][] {
  const result = points.map((p) => [...p] as [number, number]);
  const orientation = getSegmentOrientation(points[segmentIndex], points[segmentIndex + 1]);

  if (orientation === 'horizontal') {
    // Shift Y of both endpoints
    result[segmentIndex][1] += delta;
    result[segmentIndex + 1][1] += delta;
  } else if (orientation === 'vertical') {
    // Shift X of both endpoints
    result[segmentIndex][0] += delta;
    result[segmentIndex + 1][0] += delta;
  }

  return result;
}

function routeEndDirection(
  start: [number, number],
  end: [number, number],
  endDir: ConnectionSide,
): [number, number][] {
  const approach = departPoint(end, endDir);

  if (isVertical(endDir)) {
    // Approach vertically — come from horizontal
    return [start, [start[0], approach[1]], approach, end];
  } else {
    // Approach horizontally — come from vertical
    return [start, [approach[0], start[1]], approach, end];
  }
}

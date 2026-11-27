import type { Bounds, Point } from '@mavisdraw/types';

/**
 * Object snapping ("smart guides"), modelled on Excalidraw's `snapping.ts`
 * and tldraw's `BoundsSnaps`:
 *
 * - **Alignment**: a moving box's left / centre / right (top / middle /
 *   bottom) lines up with the same features of other shapes.
 * - **Equal spacing**: a box dropped between two shapes is centred in the
 *   gap, or placed so it repeats an existing gap at either end of a row or
 *   column.
 *
 * The snap distance is given in canvas units by the caller (screen pixels
 * divided by zoom), so it feels the same at every zoom level. Everything here
 * is pure: build a context once per gesture, then query it per pointer move.
 */

/** Snap distance in screen pixels (Excalidraw and tldraw both use 8). */
export const SNAP_DISTANCE_PX = 8;

/** Coordinates closer than this are treated as aligned (float noise). */
const EPSILON = 0.01;

/** A guide to draw on the overlay layer. */
export type SnapGuide =
  | {
      kind: 'align';
      /** 'x': a vertical line at x = position; 'y': a horizontal line at y = position. */
      axis: 'x' | 'y';
      position: number;
      /** Extent of the line along the other axis. */
      start: number;
      end: number;
      /** The aligned points (drawn as small crosses). */
      marks: Point[];
    }
  | {
      kind: 'gap';
      /** 'x': horizontal spacing (segments run left→right); 'y': vertical spacing. */
      axis: 'x' | 'y';
      /** The equal gaps: for axis 'x' each runs from `from` to `to` at y = `at`. */
      segments: { from: number; to: number; at: number }[];
      length: number;
    };

interface Feature {
  value: number;
  /** Points of the reference box that have this coordinate. */
  marks: Point[];
}

interface Gap {
  start: Bounds;
  end: Bounds;
  /** Distance between start's far side and end's near side. */
  length: number;
  /** Shared range on the other axis. */
  overlapStart: number;
  overlapEnd: number;
}

export interface SnapContext {
  xs: Feature[];
  ys: Feature[];
  /** Gaps between shapes side by side (spacing along x). */
  xGaps: Gap[];
  /** Gaps between shapes stacked vertically (spacing along y). */
  yGaps: Gap[];
}

/** Closest shapes to look at for gaps on each side (keeps building the context cheap). */
const GAP_NEIGHBOURS = 12;

function boxFeatures(b: Bounds): { xs: Feature[]; ys: Feature[] } {
  const right = b.x + b.width;
  const bottom = b.y + b.height;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return {
    xs: [
      { value: b.x, marks: [{ x: b.x, y: b.y }, { x: b.x, y: bottom }] },
      { value: cx, marks: [{ x: cx, y: cy }] },
      { value: right, marks: [{ x: right, y: b.y }, { x: right, y: bottom }] },
    ],
    ys: [
      { value: b.y, marks: [{ x: b.x, y: b.y }, { x: right, y: b.y }] },
      { value: cy, marks: [{ x: cx, y: cy }] },
      { value: bottom, marks: [{ x: b.x, y: bottom }, { x: right, y: bottom }] },
    ],
  };
}

function findGaps(boxes: Bounds[], axis: 'x' | 'y'): Gap[] {
  const lo = (b: Bounds) => (axis === 'x' ? b.x : b.y);
  const hi = (b: Bounds) => (axis === 'x' ? b.x + b.width : b.y + b.height);
  const crossLo = (b: Bounds) => (axis === 'x' ? b.y : b.x);
  const crossHi = (b: Bounds) => (axis === 'x' ? b.y + b.height : b.x + b.width);

  const sorted = [...boxes].sort((a, b) => lo(a) - lo(b));
  const gaps: Gap[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    let found = 0;
    for (let j = i + 1; j < sorted.length && found < GAP_NEIGHBOURS; j++) {
      const b = sorted[j];
      if (hi(a) >= lo(b)) continue; // overlapping along the axis: no gap
      const overlapStart = Math.max(crossLo(a), crossLo(b));
      const overlapEnd = Math.min(crossHi(a), crossHi(b));
      if (overlapStart > overlapEnd) continue; // not side by side
      gaps.push({ start: a, end: b, length: lo(b) - hi(a), overlapStart, overlapEnd });
      found++;
    }
  }
  return gaps;
}

/** Precompute snap targets from the boxes of the shapes that aren't moving. */
export function createSnapContext(references: Bounds[]): SnapContext {
  const xs: Feature[] = [];
  const ys: Feature[] = [];
  for (const b of references) {
    const f = boxFeatures(b);
    xs.push(...f.xs);
    ys.push(...f.ys);
  }
  return { xs, ys, xGaps: findGaps(references, 'x'), yGaps: findGaps(references, 'y') };
}

/** Best match of any candidate coordinate against the features, within `threshold`. */
function nearest(
  candidates: number[],
  features: Feature[],
  threshold: number,
): { offset: number; index: number } | null {
  let best: { offset: number; index: number } | null = null;
  let bestDistance = threshold;
  for (let i = 0; i < candidates.length; i++) {
    for (const f of features) {
      const offset = f.value - candidates[i];
      const distance = Math.abs(offset);
      if (distance <= bestDistance && (best === null || distance < bestDistance)) {
        best = { offset, index: i };
        bestDistance = distance;
      }
    }
  }
  return best;
}

/**
 * Snap arbitrary coordinates (the corner of a shape being drawn, the edge of
 * a shape being resized) to alignment features. Returns, per axis, the offset
 * to add and which candidate matched — or null when nothing is close enough.
 */
export function snapValues(
  ctx: SnapContext,
  xs: number[],
  ys: number[],
  threshold: number,
): { x: { offset: number; index: number } | null; y: { offset: number; index: number } | null } {
  return { x: nearest(xs, ctx.xs, threshold), y: nearest(ys, ctx.ys, threshold) };
}

interface GapSnap {
  offset: number;
  gap: Gap;
  kind: 'center' | 'after' | 'before';
}

/** Equal-spacing snaps for a box along one axis. */
function nearestGap(ctx: SnapContext, box: Bounds, axis: 'x' | 'y', threshold: number): GapSnap | null {
  const gaps = axis === 'x' ? ctx.xGaps : ctx.yGaps;
  const lo = axis === 'x' ? box.x : box.y;
  const size = axis === 'x' ? box.width : box.height;
  const hi = lo + size;
  const crossLo = axis === 'x' ? box.y : box.x;
  const crossHi = crossLo + (axis === 'x' ? box.height : box.width);
  const far = (b: Bounds) => (axis === 'x' ? b.x + b.width : b.y + b.height);
  const near = (b: Bounds) => (axis === 'x' ? b.x : b.y);

  let best: GapSnap | null = null;
  let bestDistance = threshold;
  const consider = (offset: number, gap: Gap, kind: GapSnap['kind']) => {
    const distance = Math.abs(offset);
    if (distance <= bestDistance && (best === null || distance < bestDistance)) {
      best = { offset, gap, kind };
      bestDistance = distance;
    }
  };

  for (const gap of gaps) {
    // The box has to sit in the same row (column) as the gap
    if (crossHi < gap.overlapStart || crossLo > gap.overlapEnd) continue;

    // Centred between the two
    if (gap.length > size) {
      const mid = far(gap.start) + gap.length / 2;
      consider(mid - (lo + size / 2), gap, 'center');
    }
    // Repeating the gap after the end shape…
    consider(far(gap.end) + gap.length - lo, gap, 'after');
    // …or before the start shape
    consider(near(gap.start) - gap.length - hi, gap, 'before');
  }
  return best;
}

/** Gap guides for a box that sits exactly at an equal spacing. */
function gapGuides(ctx: SnapContext, box: Bounds, axis: 'x' | 'y'): SnapGuide[] {
  const gaps = axis === 'x' ? ctx.xGaps : ctx.yGaps;
  const guides: SnapGuide[] = [];
  const lo = axis === 'x' ? box.x : box.y;
  const size = axis === 'x' ? box.width : box.height;
  const hi = lo + size;
  const crossLo = axis === 'x' ? box.y : box.x;
  const crossHi = crossLo + (axis === 'x' ? box.height : box.width);
  const far = (b: Bounds) => (axis === 'x' ? b.x + b.width : b.y + b.height);
  const near = (b: Bounds) => (axis === 'x' ? b.x : b.y);
  const seen = new Set<string>();

  for (const gap of gaps) {
    if (crossHi < gap.overlapStart || crossLo > gap.overlapEnd) continue;
    const at = (Math.max(crossLo, gap.overlapStart) + Math.min(crossHi, gap.overlapEnd)) / 2;
    const gapAt = (gap.overlapStart + gap.overlapEnd) / 2;
    let segments: { from: number; to: number; at: number }[] | null = null;
    let length = gap.length;

    if (gap.length > size && Math.abs(far(gap.start) + gap.length / 2 - (lo + size / 2)) < EPSILON) {
      length = (gap.length - size) / 2;
      segments = [
        { from: far(gap.start), to: lo, at },
        { from: hi, to: near(gap.end), at },
      ];
    } else if (Math.abs(far(gap.end) + gap.length - lo) < EPSILON) {
      segments = [
        { from: far(gap.start), to: near(gap.end), at: gapAt },
        { from: far(gap.end), to: lo, at },
      ];
    } else if (Math.abs(near(gap.start) - gap.length - hi) < EPSILON) {
      segments = [
        { from: hi, to: near(gap.start), at },
        { from: far(gap.start), to: near(gap.end), at: gapAt },
      ];
    }
    if (!segments) continue;
    const key = segments.map((s) => `${s.from.toFixed(2)}:${s.to.toFixed(2)}`).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    guides.push({ kind: 'gap', axis, segments, length });
  }
  return guides;
}

/**
 * Alignment guides for a box at its final position: every feature of the
 * box that lines up exactly with features of other shapes gets a line
 * through all of them, with crosses on the aligned points.
 */
export function alignmentGuides(
  ctx: SnapContext,
  box: Bounds,
  options: { x?: boolean; y?: boolean; only?: { xs?: number[]; ys?: number[] } } = {},
): SnapGuide[] {
  const guides: SnapGuide[] = [];
  const own = boxFeatures(box);
  const pass = (axis: 'x' | 'y') => {
    const features = axis === 'x' ? ctx.xs : ctx.ys;
    let mine = axis === 'x' ? own.xs : own.ys;
    const only = axis === 'x' ? options.only?.xs : options.only?.ys;
    if (only) {
      mine = only.map((value) => ({
        value,
        marks:
          axis === 'x'
            ? [{ x: value, y: box.y }, { x: value, y: box.y + box.height }]
            : [{ x: box.x, y: value }, { x: box.x + box.width, y: value }],
      }));
    }
    const done = new Set<number>();
    for (const m of mine) {
      if (done.has(Math.round(m.value * 100))) continue;
      const matches = features.filter((f) => Math.abs(f.value - m.value) < EPSILON);
      if (matches.length === 0) continue;
      done.add(Math.round(m.value * 100));
      const marks = [...m.marks, ...matches.flatMap((f) => f.marks)];
      const along = marks.map((p) => (axis === 'x' ? p.y : p.x));
      guides.push({
        kind: 'align',
        axis,
        position: m.value,
        start: Math.min(...along),
        end: Math.max(...along),
        marks,
      });
    }
  };
  if (options.x !== false) pass('x');
  if (options.y !== false) pass('y');
  return guides;
}

export interface MoveSnapResult {
  /** Correction to add to the drag offset. */
  offset: Point;
  guides: SnapGuide[];
}

/**
 * Snap a box being moved. `box` is where the raw drag would put it; the
 * result says how much further to move it and which guides to draw. Pass
 * `axes` to restrict snapping (e.g. Shift-locked to one axis).
 */
export function snapMovingBox(
  ctx: SnapContext,
  box: Bounds,
  threshold: number,
  axes: { x: boolean; y: boolean } = { x: true, y: true },
): MoveSnapResult {
  const offset = { x: 0, y: 0 };
  const xs = [box.x, box.x + box.width / 2, box.x + box.width];
  const ys = [box.y, box.y + box.height / 2, box.y + box.height];
  const point = snapValues(ctx, axes.x ? xs : [], axes.y ? ys : [], threshold);

  for (const axis of ['x', 'y'] as const) {
    if (!axes[axis]) continue;
    const align = point[axis];
    const gap = nearestGap(ctx, box, axis, threshold);
    // Prefer whichever is closer; on a tie, alignment wins (it's what people expect)
    if (align && (!gap || Math.abs(align.offset) <= Math.abs(gap.offset))) {
      offset[axis] = align.offset;
    } else if (gap) {
      offset[axis] = gap.offset;
    }
  }

  const snapped = { ...box, x: box.x + offset.x, y: box.y + offset.y };
  const guides = [
    ...alignmentGuides(ctx, snapped, { x: axes.x, y: axes.y }),
    ...(axes.x ? gapGuides(ctx, snapped, 'x') : []),
    ...(axes.y ? gapGuides(ctx, snapped, 'y') : []),
  ];
  return { offset, guides };
}

/** Round a coordinate to the nearest grid line. */
export function snapToGrid(value: number, gridSize: number): number {
  if (!(gridSize > 0)) return value;
  return Math.round(value / gridSize) * gridSize;
}

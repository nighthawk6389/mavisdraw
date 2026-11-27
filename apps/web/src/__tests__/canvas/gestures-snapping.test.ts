import { describe, it, expect } from 'vitest';
import {
  alignmentGuides,
  createSnapContext,
  snapMovingBox,
  snapToGrid,
  snapValues,
  type SnapGuide,
} from '../../components/canvas/gestures/snapping';

const A = { x: 0, y: 0, width: 100, height: 60 };
const B = { x: 200, y: 0, width: 100, height: 60 };

describe('alignment snapping', () => {
  it('pulls a nearby edge onto another shape’s edge', () => {
    const ctx = createSnapContext([A]);
    // Left edge at 3 → snaps to A's left (0); top at 205 is far from everything
    const r = snapMovingBox(ctx, { x: 3, y: 205, width: 50, height: 50 }, 8);
    expect(r.offset).toEqual({ x: -3, y: 0 });
    const guide = r.guides.find((g) => g.kind === 'align');
    expect(guide).toMatchObject({ kind: 'align', axis: 'x', position: 0 });
  });

  it('aligns centres', () => {
    const ctx = createSnapContext([A]);
    // Centre x of moving box = 52 → A's centre 50
    const r = snapMovingBox(ctx, { x: 27, y: 300, width: 50, height: 20 }, 8);
    expect(r.offset.x).toBe(-2);
  });

  it('does nothing beyond the snap distance', () => {
    const ctx = createSnapContext([A]);
    const r = snapMovingBox(ctx, { x: 120, y: 300, width: 30, height: 30 }, 8);
    expect(r.offset).toEqual({ x: 0, y: 0 });
    expect(r.guides).toEqual([]);
  });

  it('respects a locked axis', () => {
    const ctx = createSnapContext([A]);
    const r = snapMovingBox(ctx, { x: 3, y: 4, width: 50, height: 20 }, 8, { x: false, y: true });
    expect(r.offset).toEqual({ x: 0, y: -4 });
  });

  it('draws one guide through every shape on the same line', () => {
    const C = { x: 0, y: 400, width: 80, height: 40 };
    const ctx = createSnapContext([A, C]);
    const r = snapMovingBox(ctx, { x: 2, y: 200, width: 60, height: 60 }, 8);
    const guide = r.guides.find((g) => g.kind === 'align' && g.axis === 'x' && g.position === 0) as Extract<
      SnapGuide,
      { kind: 'align' }
    >;
    expect(guide.start).toBe(0);
    expect(guide.end).toBe(440);
    // crosses on A, C and the moving box
    expect(guide.marks.length).toBe(6);
  });

  it('snaps arbitrary coordinates (creation corners, resize edges)', () => {
    const ctx = createSnapContext([A]);
    const r = snapValues(ctx, [97], [500], 8);
    expect(r.x).toEqual({ offset: 3, index: 0 });
    expect(r.y).toBeNull();
  });
});

describe('equal spacing', () => {
  it('centres a box in the gap between two shapes', () => {
    const ctx = createSnapContext([A, B]);
    // Gap 100..200; a 40-wide box centred there sits at x = 130
    const r = snapMovingBox(ctx, { x: 134, y: 12, width: 40, height: 20 }, 8);
    expect(r.offset.x).toBe(-4);
    const gap = r.guides.find((g) => g.kind === 'gap');
    expect(gap).toMatchObject({ kind: 'gap', axis: 'x', length: 30 });
  });

  it('repeats an existing gap to continue a row', () => {
    const ctx = createSnapContext([A, B]);
    // A→B gap is 100, so the next box belongs at 300 + 100 = 400
    const r = snapMovingBox(ctx, { x: 405, y: 10, width: 100, height: 40 }, 8);
    expect(r.offset.x).toBe(-5);
    const gap = r.guides.find((g) => g.kind === 'gap') as Extract<SnapGuide, { kind: 'gap' }>;
    expect(gap.segments).toHaveLength(2);
    expect(gap.length).toBe(100);
  });

  it('repeats the gap before the first shape too', () => {
    const ctx = createSnapContext([A, B]);
    const r = snapMovingBox(ctx, { x: -196, y: 10, width: 100, height: 40 }, 8);
    expect(r.offset.x).toBe(-4); // right edge at -100
  });

  it('only uses gaps in the same row', () => {
    const ctx = createSnapContext([A, B]);
    const r = snapMovingBox(ctx, { x: 403, y: 300, width: 100, height: 40 }, 8);
    expect(r.offset.x).toBe(0);
  });

  it('works vertically', () => {
    const top = { x: 0, y: 0, width: 100, height: 50 };
    const mid = { x: 0, y: 100, width: 100, height: 50 };
    const ctx = createSnapContext([top, mid]);
    const r = snapMovingBox(ctx, { x: 20, y: 203, width: 60, height: 50 }, 8);
    expect(r.offset.y).toBe(-3);
  });
});

describe('alignmentGuides', () => {
  it('can be limited to specific coordinates (edges being resized)', () => {
    const ctx = createSnapContext([A]);
    const guides = alignmentGuides(ctx, { x: 100, y: 0, width: 50, height: 60 }, { only: { xs: [150], ys: [] } });
    expect(guides).toEqual([]);
    const hit = alignmentGuides(ctx, { x: 50, y: 0, width: 50, height: 60 }, { only: { xs: [100], ys: [] } });
    expect(hit).toHaveLength(1);
  });
});

describe('grid', () => {
  it('rounds to the nearest line', () => {
    expect(snapToGrid(29, 20)).toBe(20);
    expect(snapToGrid(31, 20)).toBe(40);
    expect(snapToGrid(31, 0)).toBe(31);
  });
});

import { describe, it, expect } from 'vitest';
import { getSegmentOrientation, applyElbowSegmentDrag } from '../elbow';

describe('getSegmentOrientation', () => {
  it('returns horizontal when Y values are the same', () => {
    expect(getSegmentOrientation([0, 100], [200, 100])).toBe('horizontal');
  });

  it('returns horizontal when Y values are within threshold', () => {
    expect(getSegmentOrientation([0, 100], [200, 100.5])).toBe('horizontal');
  });

  it('returns vertical when X values are the same', () => {
    expect(getSegmentOrientation([100, 0], [100, 200])).toBe('vertical');
  });

  it('returns vertical when X values are within threshold', () => {
    expect(getSegmentOrientation([100, 0], [100.5, 200])).toBe('vertical');
  });

  it('returns diagonal for non-axis-aligned segments', () => {
    expect(getSegmentOrientation([0, 0], [100, 100])).toBe('diagonal');
  });
});

describe('applyElbowSegmentDrag', () => {
  // Typical elbow route: horizontal-first L-shape
  // [0,0] → [100,0] → [100,80] → [200,80]
  const points: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 80],
    [200, 80],
  ];

  it('dragging a horizontal segment shifts Y of both endpoints', () => {
    // Segment 0: [0,0] → [100,0] is horizontal. Drag down by 30.
    const result = applyElbowSegmentDrag(points, 0, 30);
    expect(result[0]).toEqual([0, 30]);
    expect(result[1]).toEqual([100, 30]);
    // Other points unchanged
    expect(result[2]).toEqual([100, 80]);
    expect(result[3]).toEqual([200, 80]);
  });

  it('dragging a vertical segment shifts X of both endpoints', () => {
    // Segment 1: [100,0] → [100,80] is vertical. Drag right by 50.
    const result = applyElbowSegmentDrag(points, 1, 50);
    expect(result[0]).toEqual([0, 0]);
    expect(result[1]).toEqual([150, 0]);
    expect(result[2]).toEqual([150, 80]);
    expect(result[3]).toEqual([200, 80]);
  });

  it('dragging the last horizontal segment shifts Y', () => {
    // Segment 2: [100,80] → [200,80] is horizontal. Drag up by -20.
    const result = applyElbowSegmentDrag(points, 2, -20);
    expect(result[0]).toEqual([0, 0]);
    expect(result[1]).toEqual([100, 0]);
    expect(result[2]).toEqual([100, 60]);
    expect(result[3]).toEqual([200, 60]);
  });

  it('does not mutate the original points', () => {
    const original = points.map((p) => [...p]);
    applyElbowSegmentDrag(points, 1, 50);
    expect(points).toEqual(original);
  });

  it('adjacent segments auto-adjust via shared endpoints', () => {
    // Dragging vertical segment 1 right by 50:
    // Segment 0 becomes [0,0] → [150,0] (longer horizontal)
    // Segment 2 becomes [150,80] → [200,80] (shorter horizontal)
    const result = applyElbowSegmentDrag(points, 1, 50);
    // Segment 0 endpoints
    expect(result[0][1]).toBe(result[1][1]); // still horizontal
    // Segment 2 endpoints
    expect(result[2][1]).toBe(result[3][1]); // still horizontal
    // Connectivity preserved
    expect(result[1][0]).toBe(result[2][0]); // vertical connection X matches
  });
});

import { describe, it, expect } from 'vitest';
import {
  creationBox,
  dominantAxis,
  exceedsDragThreshold,
  lockToAxis,
  placedBox,
  resizeBox,
  resizeSnapCandidates,
  scaleElementBox,
  snapAngle,
  snapVectorAngle,
} from '../../components/canvas/gestures/transform';

const box = { x: 100, y: 100, width: 200, height: 100 };
const plain = { keepAspect: false, fromCenter: false };

describe('drag threshold', () => {
  it('ignores jitter below 4px for a mouse', () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 2, y: 3 })).toBe(false);
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 4, y: 3 })).toBe(true);
  });

  it('is more forgiving for touch and pen', () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 5, y: 0 }, 'touch')).toBe(false);
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 5, y: 0 }, 'pen')).toBe(false);
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 7, y: 0 }, 'touch')).toBe(true);
  });
});

describe('axis lock', () => {
  it('keeps the dominant axis only', () => {
    expect(lockToAxis({ x: 50, y: 10 })).toEqual({ x: 50, y: 0 });
    expect(lockToAxis({ x: -5, y: -30 })).toEqual({ x: 0, y: -30 });
    expect(dominantAxis({ x: 3, y: -4 })).toBe('y');
  });
});

describe('angles', () => {
  it('snaps to 15° steps', () => {
    expect(snapAngle((Math.PI / 180) * 23)).toBeCloseTo(Math.PI / 6); // 23° → 30°
    expect(snapAngle((Math.PI / 180) * 22)).toBeCloseTo(Math.PI / 12); // 22° → 15°
    expect(snapAngle((Math.PI / 180) * 7)).toBe(0);
  });

  it('keeps a vector length while snapping its direction', () => {
    const v = snapVectorAngle({ x: 100, y: 4 });
    expect(v.y).toBe(0);
    expect(v.x).toBeCloseTo(Math.hypot(100, 4));
    const d = snapVectorAngle({ x: 50, y: 52 });
    expect(d.x).toBeCloseTo(d.y);
  });
});

describe('creationBox', () => {
  it('spans origin to pointer in any direction', () => {
    expect(creationBox({ x: 100, y: 100 }, { x: 40, y: 160 }, plain)).toEqual({
      x: 40,
      y: 100,
      width: 60,
      height: 60,
    });
  });

  it('Shift draws a square (circle) on the larger side, toward the pointer', () => {
    expect(
      creationBox({ x: 100, y: 100 }, { x: 260, y: 180 }, { keepAspect: true, fromCenter: false }),
    ).toEqual({ x: 100, y: 100, width: 160, height: 160 });
    expect(
      creationBox({ x: 100, y: 100 }, { x: 60, y: 20 }, { keepAspect: true, fromCenter: false }),
    ).toEqual({ x: 20, y: 20, width: 80, height: 80 });
  });

  it('Alt grows from the centre', () => {
    expect(
      creationBox({ x: 500, y: 300 }, { x: 560, y: 340 }, { keepAspect: false, fromCenter: true }),
    ).toEqual({ x: 440, y: 260, width: 120, height: 80 });
  });

  it('Shift+Alt makes a square centred on the press', () => {
    expect(
      creationBox({ x: 0, y: 0 }, { x: 30, y: -10 }, { keepAspect: true, fromCenter: true }),
    ).toEqual({ x: -30, y: -30, width: 60, height: 60 });
  });

  it('click-to-place centres a default-size box', () => {
    expect(placedBox('rectangle', { x: 300, y: 200 })).toEqual({
      x: 220,
      y: 160,
      width: 160,
      height: 80,
    });
    expect(placedBox('portal', { x: 0, y: 0 }).width).toBe(200);
  });
});

describe('resizeBox', () => {
  it('drags the bottom-right corner, top-left stays put', () => {
    const r = resizeBox(box, 'bottom-right', { x: 40, y: 20 }, plain);
    expect(r.box).toEqual({ x: 100, y: 100, width: 240, height: 120 });
  });

  it('edge handles change one axis only', () => {
    const r = resizeBox(box, 'middle-left', { x: -50, y: 80 }, plain);
    expect(r.box).toEqual({ x: 50, y: 100, width: 250, height: 100 });
  });

  it('Alt resizes symmetrically around the centre', () => {
    const r = resizeBox(box, 'bottom-right', { x: 40, y: 20 }, { keepAspect: false, fromCenter: true });
    expect(r.box).toEqual({ x: 60, y: 80, width: 280, height: 140 });
  });

  it('Shift keeps proportions using the larger change', () => {
    const r = resizeBox(box, 'bottom-right', { x: 200, y: 10 }, { keepAspect: true, fromCenter: false });
    expect(r.box).toEqual({ x: 100, y: 100, width: 400, height: 200 });
  });

  it('Shift on an edge handle scales the other axis around the edge midpoint', () => {
    const r = resizeBox(box, 'middle-right', { x: 200, y: 0 }, { keepAspect: true, fromCenter: false });
    expect(r.box).toEqual({ x: 100, y: 50, width: 400, height: 200 });
  });

  it('flips when dragged past the opposite edge instead of getting stuck', () => {
    const r = resizeBox(box, 'bottom-right', { x: -300, y: -150 }, plain);
    expect(r.scaleX).toBeLessThan(0);
    expect(r.scaleY).toBeLessThan(0);
    expect(r.box).toEqual({ x: 0, y: 50, width: 100, height: 50 });
  });

  it('never collapses to zero', () => {
    const r = resizeBox(box, 'middle-right', { x: -200, y: 0 }, plain);
    expect(r.box.width).toBeGreaterThanOrEqual(1);
  });

  it('can refuse to flip (images)', () => {
    const r = resizeBox(box, 'bottom-right', { x: -300, y: -150 }, { ...plain, noFlip: true, minSize: 10 });
    expect(r.scaleX).toBeGreaterThan(0);
    expect(r.box).toEqual({ x: 100, y: 100, width: 10, height: 10 });
  });

  it('maps each element of a multi-selection proportionally', () => {
    const r = resizeBox(box, 'bottom-right', { x: 200, y: 100 }, plain); // 2x
    const child = scaleElementBox({ x: 200, y: 150, width: 50, height: 25 }, r);
    expect(child).toEqual({ x: 300, y: 200, width: 100, height: 50 });
  });

  it('mirrors line points when the selection flips', () => {
    const r = resizeBox(box, 'middle-right', { x: -400, y: 0 }, plain); // scaleX = -1
    const line = scaleElementBox({ x: 100, y: 100, width: 200, height: 100 }, r, [
      [0, 0],
      [200, 100],
    ]);
    expect(line.x).toBe(100);
    expect(line.points).toEqual([
      [-0, 0],
      [-200, 100],
    ]);
  });
});

describe('resizeSnapCandidates', () => {
  it('offers the dragged edge, and its mirror with Alt', () => {
    const c = resizeSnapCandidates(box, 'bottom-right', { x: 10, y: 5 }, false);
    expect(c.x).toEqual({ values: [310], k: [1] });
    expect(c.y).toEqual({ values: [205], k: [1] });
    const centred = resizeSnapCandidates(box, 'middle-left', { x: -10, y: 0 }, true);
    expect(centred.x).toEqual({ values: [90, 310], k: [1, -1] });
    expect(centred.y.values).toEqual([]);
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { MavisElement, RectangleElement } from '@mavisdraw/types';
import {
  normalizeAngle,
  resizeRotatedBox,
  rotatePoint,
  rotationDelta,
} from '../../components/canvas/gestures/transform';
import {
  getAnchorPoints,
  getVisualBounds,
  hitTestTransformHandle,
  rotationHandleCenter,
  selectionFrame,
} from '../../components/canvas/HitTesting';
import { getBindingEdgePoint, syncBoundElements } from '../../stores/elementBindings';
import { InteractionManager, type InteractionCallbacks } from '../../components/canvas/InteractionManager';
import { ViewportManager } from '../../components/canvas/ViewportManager';

const DEG = Math.PI / 180;

function rect(id: string, x: number, y: number, w: number, h: number, angle = 0): RectangleElement {
  return {
    id,
    type: 'rectangle',
    diagramId: 'd1',
    x,
    y,
    width: w,
    height: h,
    angle,
    opacity: 100,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    fillStyle: 'none',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    seed: 1,
    renderMode: 'clean',
    layerId: 'default',
    groupIds: [],
    isLocked: false,
    isDeleted: false,
    boundElements: [],
    version: 1,
    updatedAt: 0,
    roundness: 0,
  };
}

describe('rotation geometry', () => {
  it('rotates points clockwise on screen (y down)', () => {
    const p = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90 * DEG);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });

  it('normalises angles into one turn', () => {
    expect(normalizeAngle(-90 * DEG)).toBeCloseTo(270 * DEG);
    expect(normalizeAngle(Math.PI * 2)).toBe(0);
  });

  it('measures how far the pointer turned around the centre, Shift in 15° steps', () => {
    const centre = { x: 0, y: 0 };
    const start = { x: 0, y: -100 }; // straight up
    const pointer = rotatePoint(start, centre, 37 * DEG);
    expect(rotationDelta(centre, start, pointer, 0, false)).toBeCloseTo(37 * DEG);
    expect(rotationDelta(centre, start, pointer, 0, true)).toBeCloseTo(30 * DEG);
    // Snapping is on the resulting angle, not the delta
    expect(rotationDelta(centre, start, pointer, 10 * DEG, true)).toBeCloseTo(35 * DEG);
  });

  it('resizes a rotated box with the opposite corner pinned in place', () => {
    const start = { x: 100, y: 100, width: 200, height: 100 };
    const angle = 90 * DEG;
    const corner = (b: typeof start) =>
      rotatePoint({ x: b.x, y: b.y }, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, angle);
    const before = corner(start);
    // Pull the (rotated) bottom-right handle 40px down on screen: that's its own +x
    const box = resizeRotatedBox(start, angle, 'bottom-right', { x: 0, y: 40 }, {
      keepAspect: false,
      fromCenter: false,
    });
    expect(box.width).toBeCloseTo(240);
    expect(box.height).toBeCloseTo(100);
    const after = corner(box);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});

describe('rotated hit-testing', () => {
  it('measures a rotated shape by its turned corners', () => {
    const b = getVisualBounds(rect('a', 0, 0, 100, 100, 45 * DEG));
    expect(b.width).toBeCloseTo(Math.SQRT2 * 100);
    expect(b.x).toBeCloseTo(50 - (Math.SQRT2 * 100) / 2);
  });

  it('gives a single rotated shape a frame turned with it', () => {
    expect(selectionFrame([rect('a', 0, 0, 100, 50, 30 * DEG)])).toEqual({
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      angle: 30 * DEG,
    });
    // Several shapes: an axis-aligned frame
    const multi = selectionFrame([rect('a', 0, 0, 100, 50, 30 * DEG), rect('b', 300, 0, 10, 10)]);
    expect(multi?.angle).toBe(0);
  });

  it('finds the rotation handle above the frame, and handles of a turned frame', () => {
    const frame = { bounds: { x: 0, y: 0, width: 100, height: 50 }, angle: 0 };
    const handle = rotationHandleCenter(frame);
    expect(hitTestTransformHandle(handle, frame)).toEqual({ kind: 'rotate' });

    // Turned 90°: the "bottom-right" handle now sits at the bottom-left on screen
    const turned = { ...frame, angle: 90 * DEG };
    const local = { x: 104, y: 54 }; // bottom-right incl. 4px padding
    const screen = rotatePoint(local, { x: 50, y: 25 }, 90 * DEG);
    expect(hitTestTransformHandle(screen, turned)).toEqual({ kind: 'resize', handle: 'bottom-right' });
  });

  it('puts connection anchors on the turned edges', () => {
    const anchors = getAnchorPoints(rect('a', 0, 0, 200, 100, 90 * DEG));
    const top = anchors.find((a) => a.position === 'top')!;
    // The top edge's midpoint (100,0) turns about (100,50) to the right side
    expect(top.x).toBeCloseTo(150);
    expect(top.y).toBeCloseTo(50);
  });

  it('gives fingers and pens bigger handles', () => {
    const frame = { bounds: { x: 0, y: 0, width: 100, height: 50 }, angle: 0 };
    const near = { x: 104 + 10, y: 54 }; // 10px off the bottom-right handle
    expect(hitTestTransformHandle(near, frame, 1, false)).toBeNull();
    expect(hitTestTransformHandle(near, frame, 1, true)).toEqual({ kind: 'resize', handle: 'bottom-right' });
  });
});

describe('bindings on rotated shapes', () => {
  it('glues arrows to the turned outline', () => {
    // A 200×20 bar turned 90° is a tall thin bar: from the right, its edge is 10px out
    const bar = rect('bar', 0, 90, 200, 20, 90 * DEG);
    const edge = getBindingEdgePoint(bar, 500, 100, 0);
    expect(edge.x).toBeCloseTo(110);
    expect(edge.y).toBeCloseTo(100);
  });

  it('turns a label with its shape', () => {
    const shape = { ...rect('s', 0, 0, 160, 80, 30 * DEG), boundElements: [{ id: 't', type: 'text' }] };
    const label = {
      ...rect('t', 10, 10, 140, 60),
      type: 'text',
      text: 'API',
      containerId: 's',
    } as unknown as MavisElement;
    const map = new Map<string, MavisElement>([
      ['s', shape],
      ['t', label],
    ]);
    syncBoundElements(map, 's');
    expect(map.get('t')!.angle).toBeCloseTo(30 * DEG);
  });
});

function harness(initial: MavisElement[], selected: string[]) {
  const elements = new Map(initial.map((e) => [e.id, e] as const));
  let selection = new Set(selected);
  const callbacks = {
    getElements: () => Array.from(elements.values()),
    getActiveTool: () => 'select',
    getSelectedIds: () => selection,
    getViewport: () => new ViewportManager(),
    select: vi.fn(),
    selectMultiple: vi.fn((ids: string[]) => {
      selection = new Set(ids);
    }),
    addToSelection: vi.fn(),
    clearSelection: vi.fn(),
    selectElementsInBox: vi.fn(),
    setHovered: vi.fn(),
    startSelectionBox: vi.fn(),
    updateSelectionBox: vi.fn(),
    endSelectionBox: vi.fn(),
    createElement: vi.fn(),
    addElement: vi.fn(),
    updateElement: vi.fn(),
    updateElementSilent: vi.fn(),
    updateElementsSilent: vi.fn((updates: { id: string; changes: Partial<MavisElement> }[]) => {
      for (const { id, changes } of updates) {
        elements.set(id, { ...elements.get(id)!, ...changes } as MavisElement);
      }
    }),
    deleteSelectedElements: vi.fn(),
    pushHistory: vi.fn(),
    bindArrow: vi.fn(),
    unbindArrow: vi.fn(),
    moveElementWithBindings: vi.fn(),
    startTextEditing: vi.fn(),
    resetToSelect: vi.fn(),
    isToolLocked: () => false,
    invalidateStatic: vi.fn(),
  } as unknown as InteractionCallbacks;
  return { mgr: new InteractionManager(callbacks, 'd1'), el: (id: string) => elements.get(id)! };
}

describe('rotating with the handle', () => {
  // A 200×100 box at (100,100): centre (200,150); handle 26px above its top edge
  const handle = { x: 200, y: 100 - 26 };

  it('turns a single shape around its centre', () => {
    const h = harness([rect('a', 100, 100, 200, 100)], ['a']);
    h.mgr.onPointerDown(handle.x, handle.y, { button: 0, shiftKey: false });
    expect(h.mgr.getMode()).toBe('rotating');
    // Swing the pointer a quarter turn to the right of the centre
    h.mgr.onPointerMove(200 + 76, 150);
    h.mgr.onPointerUp(276, 150);
    expect(h.el('a').angle).toBeCloseTo(90 * DEG);
    expect(h.el('a')).toMatchObject({ x: 100, y: 100, width: 200, height: 100 });
  });

  it('Shift turns in 15° steps', () => {
    const h = harness([rect('a', 100, 100, 200, 100)], ['a']);
    h.mgr.onPointerDown(handle.x, handle.y, { button: 0, shiftKey: true });
    const p = rotatePoint(handle, { x: 200, y: 150 }, 22 * DEG);
    h.mgr.onPointerMove(p.x, p.y, { shiftKey: true });
    expect(h.el('a').angle).toBeCloseTo(15 * DEG);
  });

  it('turns a multi-selection around its common centre', () => {
    // Frame (0,0)–(300,100), centre (150,50)
    const h = harness([rect('a', 0, 0, 100, 100), rect('b', 200, 0, 100, 100)], ['a', 'b']);
    h.mgr.onPointerDown(150, -26, { button: 0, shiftKey: false });
    h.mgr.onPointerMove(150 + 76, 50); // +90°
    h.mgr.onPointerUp(226, 50);
    // a's centre (50,50) orbits to (150,-50)
    expect(h.el('a').x + 50).toBeCloseTo(150);
    expect(h.el('a').y + 50).toBeCloseTo(-50);
    expect(h.el('a').angle).toBeCloseTo(90 * DEG);
    expect(h.el('b').y + 50).toBeCloseTo(150);
  });

  it('Escape puts the rotation back', () => {
    const h = harness([rect('a', 100, 100, 200, 100)], ['a']);
    h.mgr.onPointerDown(handle.x, handle.y, { button: 0, shiftKey: false });
    h.mgr.onPointerMove(276, 150);
    h.mgr.cancelGesture();
    expect(h.el('a').angle).toBe(0);
  });

  it('resizes a rotated shape from its turned handles', () => {
    const h = harness([rect('a', 100, 100, 200, 100, 90 * DEG)], ['a']);
    // Turned 90° about (200,150), the bottom-right handle shows at the bottom-left
    const br = rotatePoint({ x: 304, y: 204 }, { x: 200, y: 150 }, 90 * DEG);
    h.mgr.onPointerDown(br.x, br.y, { button: 0, shiftKey: false });
    expect(h.mgr.getMode()).toBe('resizing');
    h.mgr.onPointerMove(br.x, br.y + 40);
    h.mgr.onPointerUp(br.x, br.y + 40);
    expect(h.el('a').width).toBeCloseTo(240);
    expect(h.el('a').angle).toBeCloseTo(90 * DEG);
  });
});

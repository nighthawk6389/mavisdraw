import { describe, it, expect, vi } from 'vitest';
import {
  InteractionManager,
  type InteractionCallbacks,
} from '../../components/canvas/InteractionManager';
import { ViewportManager } from '../../components/canvas/ViewportManager';
import type { LinearElement, MavisElement, RectangleElement } from '@mavisdraw/types';
import type { Tool } from '../../stores/toolStore';

function rect(id: string, x: number, y: number, w: number, h: number): RectangleElement {
  return {
    id,
    type: 'rectangle',
    diagramId: 'd1',
    x,
    y,
    width: w,
    height: h,
    angle: 0,
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

/**
 * An InteractionManager wired to a tiny in-memory store, so tests can assert
 * where things end up rather than which callbacks fired. The viewport is at
 * 100% with no scroll: screen coordinates equal canvas coordinates.
 */
function harness(initial: MavisElement[], options: { tool?: Tool; selected?: string[]; grid?: number } = {}) {
  const elements = new Map(initial.map((e) => [e.id, e] as const));
  let selected = new Set(options.selected ?? []);
  let tool: Tool = options.tool ?? 'select';
  const viewport = new ViewportManager();
  let created = 0;

  const callbacks: InteractionCallbacks = {
    getElements: () => Array.from(elements.values()).filter((e) => !e.isDeleted),
    getActiveTool: () => tool,
    getSelectedIds: () => selected,
    getViewport: () => viewport,
    select: vi.fn((id: string) => {
      selected = new Set([id]);
    }),
    selectMultiple: vi.fn((ids: string[]) => {
      selected = new Set(ids);
    }),
    addToSelection: vi.fn((id: string) => {
      selected = new Set([...selected, id]);
    }),
    clearSelection: vi.fn(() => {
      selected = new Set();
    }),
    selectElementsInBox: vi.fn((ids: string[]) => {
      selected = new Set(ids);
    }),
    setHovered: vi.fn(),
    startSelectionBox: vi.fn(),
    updateSelectionBox: vi.fn(),
    endSelectionBox: vi.fn(),
    createElement: vi.fn((type, _d, x, y, w, h) => {
      const base = rect(`new-${++created}`, x, y, w, h);
      if (type === 'arrow' || type === 'line') {
        return {
          ...base,
          type,
          points: [
            [0, 0],
            [w, h],
          ],
          startBinding: null,
          endBinding: null,
          routingMode: 'straight',
          startArrowhead: 'none',
          endArrowhead: 'arrow',
        } as LinearElement;
      }
      return base;
    }),
    addElement: vi.fn((el: MavisElement) => {
      elements.set(el.id, el);
    }),
    updateElement: vi.fn(),
    updateElementSilent: vi.fn((id: string, changes: Partial<MavisElement>) => {
      const current = elements.get(id);
      if (current) elements.set(id, { ...current, ...changes } as MavisElement);
    }),
    updateElementsSilent: vi.fn((updates) => {
      for (const { id, changes } of updates) {
        const current = elements.get(id);
        if (current) elements.set(id, { ...current, ...changes } as MavisElement);
      }
    }),
    duplicateElements: vi.fn((ids: string[]) =>
      ids.map((id) => {
        const copy = { ...elements.get(id)!, id: `${id}-copy` };
        elements.set(copy.id, copy);
        return copy;
      }),
    ),
    discardElements: vi.fn((ids: string[]) => ids.forEach((id) => elements.delete(id))),
    deleteSelectedElements: vi.fn(),
    pushHistory: vi.fn(),
    bindArrow: vi.fn(),
    unbindArrow: vi.fn(),
    moveElementWithBindings: vi.fn(),
    startTextEditing: vi.fn(),
    resetToSelect: vi.fn(() => {
      tool = 'select';
    }),
    isToolLocked: () => false,
    getGridSnap: () => options.grid ?? null,
    invalidateStatic: vi.fn(),
  };
  const mgr = new InteractionManager(callbacks, 'd1');
  return {
    mgr,
    callbacks,
    el: (id: string) => elements.get(id)!,
    all: () => Array.from(elements.values()),
    selected: () => Array.from(selected),
    /** Press, move in steps, release. */
    drag(from: [number, number], to: [number, number], mods: Record<string, boolean> = {}) {
      mgr.onPointerDown(from[0], from[1], { button: 0, shiftKey: false, ...mods });
      for (let i = 1; i <= 5; i++) {
        const t = i / 5;
        mgr.onPointerMove(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, {
          shiftKey: false,
          ...mods,
        });
      }
      mgr.onPointerUp(to[0], to[1]);
    },
  };
}

describe('moving', () => {
  it('ignores jitter below the drag threshold (a click never nudges a shape)', () => {
    const h = harness([rect('a', 100, 100, 100, 60)]);
    h.drag([150, 130], [152, 131]);
    expect(h.el('a')).toMatchObject({ x: 100, y: 100 });
    expect(h.callbacks.updateElementsSilent).not.toHaveBeenCalled();
  });

  it('moves all selected shapes in one store update per pointer move', () => {
    const h = harness([rect('a', 100, 100, 100, 60), rect('b', 400, 400, 50, 50)], {
      selected: ['a', 'b'],
    });
    h.mgr.onPointerDown(150, 130, { button: 0, shiftKey: false });
    h.mgr.onPointerMove(173, 147);
    expect(h.callbacks.updateElementsSilent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.callbacks.updateElementsSilent).mock.calls[0][0]).toHaveLength(2);
    h.mgr.onPointerUp(173, 147);
    expect(h.el('a')).toMatchObject({ x: 123, y: 117 });
    expect(h.el('b')).toMatchObject({ x: 423, y: 417 });
  });

  it('Shift locks the move to the dominant axis', () => {
    const h = harness([rect('a', 100, 100, 100, 60)]);
    h.drag([150, 130], [263, 151], { shiftKey: true });
    expect(h.el('a')).toMatchObject({ x: 213, y: 100 });
  });

  it('pressing Shift mid-drag locks the axis without waiting for the pointer', () => {
    const h = harness([rect('a', 100, 100, 100, 60)]);
    h.mgr.onPointerDown(150, 130, { button: 0, shiftKey: false });
    h.mgr.onPointerMove(263, 151, { shiftKey: false });
    expect(h.el('a').y).toBe(121);
    h.mgr.onModifiersChange({ shiftKey: true });
    expect(h.el('a')).toMatchObject({ x: 213, y: 100 });
  });

  it('snaps to another shape’s edge and shows a guide', () => {
    const h = harness([rect('a', 100, 100, 100, 60), rect('b', 400, 300, 80, 80)]);
    // Drag a so its left edge lands 3px right of b's left edge (403)
    h.mgr.onPointerDown(150, 130, { button: 0, shiftKey: false });
    h.mgr.onPointerMove(453, 230);
    expect(h.el('a').x).toBe(400);
    const guides = h.mgr.getSmartGuides();
    expect(guides.some((g) => g.kind === 'align' && g.axis === 'x' && g.position === 400)).toBe(true);
    h.mgr.onPointerUp(453, 230);
    expect(h.mgr.getSmartGuides()).toEqual([]);
  });

  it('Ctrl/Cmd moves freely without snapping', () => {
    const h = harness([rect('a', 100, 100, 100, 60), rect('b', 400, 300, 80, 80)]);
    h.drag([150, 130], [453, 230], { ctrlKey: true });
    expect(h.el('a').x).toBe(403);
  });

  it('snaps to the grid when grid snapping is on', () => {
    const h = harness([rect('a', 100, 100, 100, 60)], { grid: 20 });
    h.drag([150, 130], [177, 138]);
    expect(h.el('a')).toMatchObject({ x: 120, y: 100 });
  });

  it('Alt-drag leaves the original and moves a copy', () => {
    const h = harness([rect('a', 100, 100, 100, 60)]);
    h.drag([150, 130], [150, 330], { altKey: true });
    expect(h.callbacks.duplicateElements).toHaveBeenCalledWith(['a']);
    expect(h.el('a')).toMatchObject({ x: 100, y: 100 });
    expect(h.el('a-copy')).toMatchObject({ x: 100, y: 300 });
    expect(h.selected()).toEqual(['a-copy']);
  });

  it('Escape mid-drag puts everything back (and drops Alt-drag copies)', () => {
    const h = harness([rect('a', 100, 100, 100, 60)]);
    h.mgr.onPointerDown(150, 130, { button: 0, shiftKey: false });
    h.mgr.onPointerMove(250, 230);
    expect(h.el('a').x).toBe(200);
    h.mgr.cancelGesture();
    expect(h.el('a')).toMatchObject({ x: 100, y: 100 });
    expect(h.mgr.getMode()).toBe('idle');

    h.mgr.resetClickTracking(); // a new gesture, not the second half of a double-click
    h.mgr.onPointerDown(150, 130, { button: 0, shiftKey: false, altKey: true });
    h.mgr.onPointerMove(150, 330, { shiftKey: false, altKey: true });
    expect(h.all()).toHaveLength(2);
    h.mgr.cancelGesture();
    expect(h.all()).toHaveLength(1);
    expect(h.selected()).toEqual(['a']);
  });

  it('wants edge scrolling only once a drag is under way', () => {
    const h = harness([rect('a', 100, 100, 100, 60)]);
    h.mgr.onPointerDown(150, 130, { button: 0, shiftKey: false });
    expect(h.mgr.wantsEdgeScroll()).toBe(false);
    h.mgr.onPointerMove(170, 150);
    expect(h.mgr.wantsEdgeScroll()).toBe(true);
    h.mgr.onPointerUp(170, 150);
    expect(h.mgr.wantsEdgeScroll()).toBe(false);
  });
});

describe('selecting', () => {
  it('Shift-click on a selected shape deselects it', () => {
    const h = harness([rect('a', 100, 100, 100, 60), rect('b', 300, 100, 100, 60)], {
      selected: ['a', 'b'],
    });
    h.mgr.onPointerDown(150, 130, { button: 0, shiftKey: true });
    h.mgr.onPointerUp(150, 130);
    expect(h.selected()).toEqual(['b']);
  });

  it('Shift-drag of a selected shape moves the selection instead of deselecting', () => {
    const h = harness([rect('a', 100, 100, 100, 60), rect('b', 300, 100, 100, 60)], {
      selected: ['a', 'b'],
    });
    h.drag([150, 130], [150, 190], { shiftKey: true });
    expect(h.selected().sort()).toEqual(['a', 'b']);
    expect(h.el('b').y).toBe(160);
  });

  it('clicking one shape of a multi-selection selects just that shape', () => {
    const h = harness([rect('a', 100, 100, 100, 60), rect('b', 300, 100, 100, 60)], {
      selected: ['a', 'b'],
    });
    h.mgr.onPointerDown(350, 130, { button: 0, shiftKey: false });
    h.mgr.onPointerUp(350, 130);
    expect(h.selected()).toEqual(['b']);
  });

  it('dragging empty space inside the selection frame moves the whole selection', () => {
    const h = harness([rect('a', 100, 100, 100, 60), rect('b', 300, 100, 100, 60)], {
      selected: ['a', 'b'],
    });
    // (250, 130) is between the two shapes but inside their common frame
    h.drag([250, 130], [250, 230]);
    expect(h.el('a').y).toBe(200);
    expect(h.el('b').y).toBe(200);
    expect(h.selected().sort()).toEqual(['a', 'b']);
  });

  it('a click on empty space inside the frame deselects', () => {
    const h = harness([rect('a', 100, 100, 100, 60), rect('b', 300, 100, 100, 60)], {
      selected: ['a', 'b'],
    });
    h.mgr.onPointerDown(250, 130, { button: 0, shiftKey: false });
    h.mgr.onPointerUp(250, 130);
    expect(h.selected()).toEqual([]);
  });

  it('the marquee selects live while dragging; Ctrl/Cmd requires full containment', () => {
    const h = harness([rect('a', 100, 100, 100, 60), rect('b', 300, 100, 100, 60)]);
    h.mgr.onPointerDown(50, 50, { button: 0, shiftKey: false });
    h.mgr.onPointerMove(150, 150);
    expect(h.selected()).toEqual(['a']); // touching a is enough
    h.mgr.onPointerMove(350, 200);
    expect(h.selected().sort()).toEqual(['a', 'b']);
    h.mgr.onModifiersChange({ shiftKey: false, ctrlKey: true });
    expect(h.selected()).toEqual(['a']); // b is only half inside
    h.mgr.onPointerUp(350, 200);
    expect(h.selected()).toEqual(['a']);
  });

  it('Shift-marquee adds to the selection', () => {
    const h = harness([rect('a', 100, 100, 100, 60), rect('b', 300, 100, 100, 60)], {
      selected: ['a'],
    });
    h.drag([280, 80], [320, 120], { shiftKey: true });
    expect(h.selected().sort()).toEqual(['a', 'b']);
  });

  it('a marquee only grabs a connector when it crosses the line itself', () => {
    const diagonal: LinearElement = {
      ...rect('arrow', 0, 0, 400, 400),
      type: 'arrow',
      points: [
        [0, 0],
        [400, 400],
      ],
      startBinding: null,
      endBinding: null,
      routingMode: 'straight',
      startArrowhead: 'none',
      endArrowhead: 'arrow',
    };
    const h = harness([diagonal]);
    // Inside the arrow's bounding box but far from the line
    h.drag([300, 20], [380, 90]);
    expect(h.selected()).toEqual([]);
    h.drag([150, 100], [250, 220]);
    expect(h.selected()).toEqual(['arrow']);
  });
});

describe('drawing', () => {
  it('Shift draws a square, Alt draws from the centre', () => {
    const h = harness([], { tool: 'rectangle' });
    h.drag([100, 100], [260, 180], { shiftKey: true });
    expect(h.all()[0]).toMatchObject({ x: 100, y: 100, width: 160, height: 160 });

    const g = harness([], { tool: 'rectangle' });
    g.drag([500, 300], [560, 340], { altKey: true });
    expect(g.all()[0]).toMatchObject({ x: 440, y: 260, width: 120, height: 80 });
  });

  it('the dragged corner snaps to other shapes', () => {
    const h = harness([rect('a', 300, 100, 100, 60)], { tool: 'rectangle' });
    h.drag([100, 300], [205 + 0, 103]);
    const drawn = h.all().find((e) => e.id !== 'a')!;
    // top (103) snapped to a's top (100); right edge free
    expect(drawn).toMatchObject({ x: 100, y: 100, width: 105, height: 200 });
  });

  it('Shift draws connectors in 15° steps', () => {
    const h = harness([], { tool: 'arrow' });
    h.drag([100, 100], [300, 110], { shiftKey: true });
    const arrow = h.all()[0] as LinearElement;
    expect(arrow.points[1][1]).toBe(0);
  });
});

describe('resizing', () => {
  // Bottom-right handle of a (100,100 200×100) sits at the padded corner (304, 204)
  it('Alt resizes from the centre', () => {
    const h = harness([rect('a', 100, 100, 200, 100)], { selected: ['a'] });
    h.drag([304, 204], [344, 224], { altKey: true });
    expect(h.el('a')).toMatchObject({ x: 60, y: 80, width: 280, height: 140 });
  });

  it('flips when dragged past the opposite edge', () => {
    const h = harness([rect('a', 100, 100, 200, 100)], { selected: ['a'] });
    h.drag([304, 204], [4, 54]);
    expect(h.el('a')).toMatchObject({ x: 0, y: 50, width: 100, height: 50 });
  });

  it('the dragged edge snaps to other shapes', () => {
    const h = harness([rect('a', 100, 100, 200, 100), rect('b', 500, 400, 50, 50)], {
      selected: ['a'],
    });
    // Right edge would land at 503 → snaps to b's left (500)
    h.drag([304, 150], [507, 150]);
    expect(h.el('a').width).toBe(400);
  });
});

function arrow(id: string, from: [number, number], to: [number, number]): LinearElement {
  return {
    ...rect(id, from[0], from[1], to[0] - from[0], to[1] - from[1]),
    type: 'arrow',
    points: [
      [0, 0],
      [to[0] - from[0], to[1] - from[1]],
    ],
    startBinding: null,
    endBinding: null,
    routingMode: 'straight',
    startArrowhead: 'none',
    endArrowhead: 'arrow',
  };
}

describe('connection dots', () => {
  it('a click on a shape’s dot selects the shape; a drag from it draws a connector', () => {
    const h = harness([rect('a', 200, 200, 200, 100)]);
    // Hovering shows the dots; the top one is the middle of the top edge
    h.mgr.onPointerMove(300, 250);
    h.mgr.onPointerMove(300, 201);
    h.mgr.onPointerDown(300, 201, { button: 0, shiftKey: false });
    h.mgr.onPointerMove(301, 202); // a wobble, not a drag
    h.mgr.onPointerUp(301, 202);
    expect(h.selected()).toEqual(['a']);
    expect(h.all()).toHaveLength(1);

    const g = harness([rect('a', 200, 200, 200, 100)]);
    g.mgr.onPointerMove(300, 201);
    g.drag([300, 201], [300, 60]);
    expect(g.all().map((e) => e.type)).toEqual(['rectangle', 'arrow']);
  });

  it('answer at the same distance on screen at any zoom', () => {
    const h = harness([rect('a', 200, 200, 200, 100)]);
    h.callbacks.getViewport().setViewport({ scrollX: 0, scrollY: 0, zoom: 4 });
    // 30 screen px (7.5 canvas units) below the top dot: on the shape, not the dot
    h.mgr.onPointerMove(1200, 830);
    h.drag([1200, 830], [1200, 1030]);
    expect(h.all()).toHaveLength(1);
    expect(h.el('a').y).toBe(250);
  });
});

describe('deep select', () => {
  it('Ctrl/Cmd+click picks one shape inside a group, even straight after a click', () => {
    const a = { ...rect('a', 100, 100, 100, 60), groupIds: ['g'] };
    const b = { ...rect('b', 300, 100, 100, 60), groupIds: ['g'] };
    const h = harness([a, b]);
    h.mgr.onPointerDown(150, 130, { button: 0, shiftKey: false });
    h.mgr.onPointerUp(150, 130);
    expect(h.selected().sort()).toEqual(['a', 'b']);
    // Within the double-click window, at the same spot: still a pick, not a double-click
    h.mgr.onPointerDown(150, 130, { button: 0, shiftKey: false, ctrlKey: true });
    h.mgr.onPointerUp(150, 130);
    expect(h.selected()).toEqual(['a']);
    expect(h.callbacks.startTextEditing).not.toHaveBeenCalled();
  });
});

describe('connector points snap', () => {
  it('an arrow’s loose end lines up with a shape’s centre and shows a guide', () => {
    const h = harness([rect('a', 100, 100, 100, 60), arrow('arr', [300, 300], [500, 300])], {
      selected: ['arr'],
    });
    h.mgr.onPointerDown(500, 300, { button: 0, shiftKey: false });
    h.mgr.onPointerMove(500, 200);
    h.mgr.onPointerMove(500, 133);
    const end = (h.el('arr') as LinearElement).points[1];
    expect(300 + end[1]).toBe(130);
    expect(h.mgr.getSmartGuides().some((g) => g.kind === 'align' && g.axis === 'y')).toBe(true);
    h.mgr.onPointerUp(500, 133);
  });

  it('Ctrl/Cmd leaves the end where the pointer is', () => {
    const h = harness([rect('a', 100, 100, 100, 60), arrow('arr', [300, 300], [500, 300])], {
      selected: ['arr'],
    });
    h.drag([500, 300], [500, 133], { ctrlKey: true });
    const end = (h.el('arr') as LinearElement).points[1];
    expect(300 + end[1]).toBe(133);
  });
});

describe('resizing a selection with a turned shape', () => {
  it('scales uniformly, so the turned shape isn’t sheared', () => {
    const turned = { ...rect('a', 200, 200, 200, 100), angle: Math.PI / 2 };
    const h = harness([turned, rect('b', 500, 200, 100, 60)], { selected: ['a', 'b'] });
    // The frame is (250,150)–(600,350); its bottom-right handle is at the padded corner
    h.drag([604, 354], [804, 374]);
    const b = h.el('b');
    expect(b.width / b.height).toBeCloseTo(100 / 60, 5);
    expect(b.width).toBeGreaterThan(100);
    expect(h.el('a').width / h.el('a').height).toBeCloseTo(2, 5);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteractionManager, type InteractionCallbacks } from '../../components/canvas/InteractionManager';
import { ViewportManager } from '../../components/canvas/ViewportManager';
import type { RectangleElement } from '@mavisdraw/types';

function makeRect(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
): RectangleElement {
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
    renderMode: 'sketchy',
    layerId: 'default',
    groupIds: [],
    isLocked: false,
    isDeleted: false,
    boundElements: [],
    version: 1,
    updatedAt: Date.now(),
    roundness: 0,
  };
}

function createMockCallbacks(overrides?: Partial<InteractionCallbacks>): InteractionCallbacks {
  const viewport = new ViewportManager();
  let activeTool: string = 'select';

  return {
    getElements: () => [],
    getActiveTool: () => activeTool as any,
    getSelectedIds: () => new Set<string>(),
    getViewport: () => viewport,

    select: vi.fn(),
    selectMultiple: vi.fn(),
    addToSelection: vi.fn(),
    clearSelection: vi.fn(),
    selectElementsInBox: vi.fn(),
    setHovered: vi.fn(),

    startSelectionBox: vi.fn(),
    updateSelectionBox: vi.fn(),
    endSelectionBox: vi.fn(),

    createElement: vi.fn((type, diagramId, x, y, w, h) =>
      makeRect(`new-${type}`, x, y, w, h),
    ),
    addElement: vi.fn(),
    updateElement: vi.fn(),
    deleteSelectedElements: vi.fn(),
    pushHistory: vi.fn(),

    bindArrow: vi.fn(),
    unbindArrow: vi.fn(),
    moveElementWithBindings: vi.fn(),

    startTextEditing: vi.fn(),

    resetToSelect: vi.fn(() => {
      activeTool = 'select';
    }),
    isToolLocked: () => false,

    invalidateStatic: vi.fn(),
    ...overrides,
  };
}

describe('InteractionManager', () => {
  describe('creatingElement lifecycle', () => {
    let mgr: InteractionManager;
    let callbacks: InteractionCallbacks;

    beforeEach(() => {
      callbacks = createMockCallbacks({
        getActiveTool: () => 'rectangle' as any,
      });
      mgr = new InteractionManager(callbacks, 'd1');
    });

    it('creatingElement is null before interaction', () => {
      expect(mgr.getCreatingElement()).toBeNull();
    });

    it('creatingElement is populated during drag', () => {
      mgr.onPointerDown(100, 100, { button: 0, shiftKey: false });
      expect(mgr.getMode()).toBe('creating');

      mgr.onPointerMove(200, 200);
      const el = mgr.getCreatingElement();
      expect(el).not.toBeNull();
      expect(el!.type).toBe('rectangle');
      expect(el!.width).toBeGreaterThan(0);
      expect(el!.height).toBeGreaterThan(0);
    });

    it('creatingElement grows as mouse moves further', () => {
      mgr.onPointerDown(100, 100, { button: 0, shiftKey: false });

      mgr.onPointerMove(150, 150);
      const first = mgr.getCreatingElement();
      const firstArea = first!.width * first!.height;

      mgr.onPointerMove(250, 250);
      const second = mgr.getCreatingElement();
      const secondArea = second!.width * second!.height;

      expect(secondArea).toBeGreaterThan(firstArea);
    });

    it('creatingElement is null after pointer up', () => {
      mgr.onPointerDown(100, 100, { button: 0, shiftKey: false });
      mgr.onPointerMove(200, 200);
      expect(mgr.getCreatingElement()).not.toBeNull();

      mgr.onPointerUp(200, 200);
      expect(mgr.getCreatingElement()).toBeNull();
      expect(mgr.getMode()).toBe('idle');
    });

    it('element is added to store on pointer up', () => {
      mgr.onPointerDown(100, 100, { button: 0, shiftKey: false });
      mgr.onPointerMove(200, 200);
      mgr.onPointerUp(200, 200);

      expect(callbacks.addElement).toHaveBeenCalledTimes(1);
    });

    it('too-small drag does not add element', () => {
      mgr.onPointerDown(100, 100, { button: 0, shiftKey: false });
      mgr.onPointerMove(101, 101);
      mgr.onPointerUp(101, 101);

      expect(callbacks.addElement).not.toHaveBeenCalled();
    });
  });

  describe('text tool', () => {
    it('creates text element on pointer down and starts editing', () => {
      const callbacks = createMockCallbacks({
        getActiveTool: () => 'text' as any,
      });
      const mgr = new InteractionManager(callbacks, 'd1');

      mgr.onPointerDown(200, 200, { button: 0, shiftKey: false });

      expect(callbacks.createElement).toHaveBeenCalledWith(
        'text',
        'd1',
        expect.any(Number),
        expect.any(Number),
        200,
        30,
      );
      expect(callbacks.addElement).toHaveBeenCalled();
      expect(callbacks.startTextEditing).toHaveBeenCalled();
      expect(callbacks.select).toHaveBeenCalled();
    });

    it('resets to select tool after text creation (not locked)', () => {
      const callbacks = createMockCallbacks({
        getActiveTool: () => 'text' as any,
      });
      const mgr = new InteractionManager(callbacks, 'd1');

      mgr.onPointerDown(200, 200, { button: 0, shiftKey: false });
      expect(callbacks.resetToSelect).toHaveBeenCalled();
    });
  });

  describe('arrow creation', () => {
    it('creates arrow with correct points during drag', () => {
      const callbacks = createMockCallbacks({
        getActiveTool: () => 'arrow' as any,
        createElement: vi.fn((type, diagramId, x, y, w, h) => ({
          ...makeRect(`new-${type}`, x, y, w, h),
          type: 'arrow' as const,
          points: [[0, 0], [w, h]] as [number, number][],
          startBinding: null,
          endBinding: null,
          routingMode: 'straight' as const,
          startArrowhead: 'none' as const,
          endArrowhead: 'arrow' as const,
        })),
      });
      const mgr = new InteractionManager(callbacks, 'd1');

      mgr.onPointerDown(100, 100, { button: 0, shiftKey: false });
      mgr.onPointerMove(300, 250);

      const el = mgr.getCreatingElement();
      expect(el).not.toBeNull();
      expect(el!.type).toBe('arrow');
      expect('points' in el!).toBe(true);
    });
  });

  describe('smart guides', () => {
    it('guides are empty by default', () => {
      const callbacks = createMockCallbacks();
      const mgr = new InteractionManager(callbacks, 'd1');
      expect(mgr.getSmartGuides()).toEqual([]);
    });
  });

  describe('panning', () => {
    it('enters panning mode on middle-click', () => {
      const callbacks = createMockCallbacks();
      const mgr = new InteractionManager(callbacks, 'd1');

      mgr.onPointerDown(200, 200, { button: 1, shiftKey: false });
      expect(mgr.getMode()).toBe('panning');
    });

    it('enters panning mode when space is pressed', () => {
      const callbacks = createMockCallbacks();
      const mgr = new InteractionManager(callbacks, 'd1');
      mgr.setSpacePressed(true);

      mgr.onPointerDown(200, 200, { button: 0, shiftKey: false });
      expect(mgr.getMode()).toBe('panning');
    });
  });
});

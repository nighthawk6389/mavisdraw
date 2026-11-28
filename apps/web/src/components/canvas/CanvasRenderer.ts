import rough from 'roughjs';
import type { RoughCanvas } from 'roughjs/bin/canvas';
import type {
  MavisElement,
  RenderMode,
  Bounds,
  RectangleElement,
  LinearElement,
  TextElement,
  ImageElement,
  PortalElement,
  Point,
} from '@mavisdraw/types';
import { ViewportManager } from './ViewportManager';
import { GridRenderer } from './GridRenderer';
import { renderPortalSketchy, renderPortalClean } from '../elements/PortalRenderer';
import {
  ROTATION_HANDLE_RADIUS_PX,
  SELECTION_PADDING_PX,
  getAnchorDots,
  ANCHOR_DOT_OFFSET_PX,
  computeElbowPoints,
  rotationHandleCenter,
  selectionFrame,
} from './HitTesting';
import type { SnapGuide } from './gestures/snapping';
import { cssFont } from '../../utils/fonts';
import type { Drawable } from 'roughjs/bin/core';
import { changedSince, liveSpan, type LivePlan } from './staticLayerPlan';
import { cylinderPaths, iconById, iconPlacement, queuePaths } from '@mavisdraw/export/library';
import type { Viewport } from '@mavisdraw/types';
import { getCubicControlPoints } from '@mavisdraw/math';

/** How long the layer bitmaps outlive the last frame that used them. */
const LAYER_KEEP_MS = 5000;

/** Alignment / equal-spacing guides shown while moving, drawing or resizing. */
export type SmartGuide = SnapGuide;

/**
 * Describes the current interactive/UI state needed for rendering.
 * Passed in each frame so the renderer always draws the latest state.
 */
/**
 * A remote user's selection info, used to render soft-lock borders.
 */
export interface RemoteSelectionInfo {
  userId: string;
  userName: string;
  color: string;
  elementIds: string[];
}

function portalUsersKey(users: Map<string, number> | undefined): string {
  if (!users || users.size === 0) return '';
  return Array.from(users, ([id, n]) => `${id}:${n}`)
    .sort()
    .join(',');
}

/** An offscreen copy of part of the static layer. */
interface LayerBitmap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  rough: RoughCanvas;
}

export interface RenderState {
  renderMode: RenderMode;
  selectedIds: Set<string>;
  hoveredId: string | null;
  selectionBox: { x: number; y: number; width: number; height: number } | null;
  creatingElement: MavisElement | null;
  showGrid: boolean;
  gridSize: number;
  smartGuides?: SmartGuide[];
  boundTextElements?: Map<string, TextElement>;
  /** Remote users' selections for rendering soft-lock borders */
  remoteSelections?: RemoteSelectionInfo[];
  /** Map of targetDiagramId -> active user count for portal badges */
  portalActiveUsers?: Map<string, number>;
  anchorTarget?: MavisElement | null;
  hoveredAnchor?: string | null;
  rebindingPreview?: { element: LinearElement; endpoint: 'start' | 'end' } | null;
  snapTarget?: { element: MavisElement; anchor: string } | null;
  /** The eraser's recent path, canvas coordinates. */
  eraserTrail?: Point[];
  /** The lasso being drawn, canvas coordinates. */
  lassoPath?: Point[];
}

/**
 * Dual-canvas rendering engine for MavisDraw.
 *
 * Uses two stacked HTML canvases:
 *   - **Static canvas**: committed elements + grid background.
 *     Only redrawn when elements or viewport change (`needsStaticRedraw` flag).
 *   - **Interactive canvas**: selection overlays, resize handles, hover
 *     highlights, and the element currently being created. Redrawn every frame.
 *
 * Rough.js is used for "sketchy" rendering mode. Clean mode uses native
 * Canvas 2D Path2D operations.
 */
export class CanvasRenderer {
  private staticCanvas: HTMLCanvasElement;
  private interactiveCanvas: HTMLCanvasElement;
  private staticCtx: CanvasRenderingContext2D;
  private interactiveCtx: CanvasRenderingContext2D;
  private roughCanvas: RoughCanvas;
  private viewport: ViewportManager;
  private gridRenderer: GridRenderer;
  private animationFrameId: number | null = null;
  private needsStaticRedraw = true;
  /** Redraw every shape next frame, even if only a few changed (an image loaded, a resize). */
  private needsFullStaticRedraw = true;
  /** What the static layer was last drawn from, to tell which shapes changed since. */
  private lastStaticFrame: { signature: unknown[]; elements: MavisElement[] } | null = null;
  /**
   * While a few shapes change frame after frame (a drag, typing a label),
   * everything below and above them in stacking order, kept as bitmaps.
   */
  private layerCache: {
    hot: Set<string>;
    span: LivePlan;
    drawnOutside: number;
  } | null = null;
  private layerBitmaps: { below: LayerBitmap; above: LayerBitmap } | null = null;
  /** Lets go of the layer bitmaps (two screen-sized canvases) once drags stop. */
  private releaseLayersTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The dark theme inverts the canvas for display (styles/dark.css): images
   * are drawn inverted so they show as they are.
   */
  private darkMode = false;
  /** The rough.js canvas that draws into each context (bitmaps have their own). */
  private roughByCtx = new Map<CanvasRenderingContext2D, RoughCanvas>();
  private needsInteractiveRedraw = true;
  private lastInteractiveSignature: unknown[] = [];
  private lastPublishedViewport: Viewport | null = null;

  /** Called (at most once per frame) when pan or zoom changes. */
  onViewportChange: ((viewport: Viewport) => void) | null = null;

  /**
   * Rough.js drawables keyed by the (immutable) element object. Any edit
   * creates a new element object, so stale entries simply become garbage.
   */
  private roughCache = new WeakMap<MavisElement, Drawable[]>();
  /** The route an elbow connector's cached drawables were made for. */
  private roughRouteFor = new WeakMap<MavisElement, [number, number][]>();
  private cacheElement: MavisElement | null = null;
  private cachePart = 0;

  /** Number of elements drawn in the last static pass (for perf tests). */
  lastDrawnCount = 0;
  /** How long the last static pass took, in ms (for perf tests). */
  lastStaticMs = 0;
  /** Which way the last static pass went: 'full', 'build' or 'cached' (for tests). */
  lastStaticPath: 'full' | 'build' | 'cached' = 'full';

  // Image cache to prevent re-decoding
  private imageCache: Map<string, HTMLImageElement> = new Map();

  // Elements map for looking up bound elements during elbow routing
  private elementsMap: Map<string, MavisElement> = new Map();

  // Selection / handle visual constants
  private static readonly SELECTION_COLOR = '#4a90d9';
  private static readonly HOVER_COLOR = '#4a90d9';
  private static readonly HANDLE_SIZE = 8;
  private static readonly HANDLE_FILL = '#ffffff';
  private static readonly SMART_GUIDE_COLOR = '#e74c3c';

  constructor(
    staticCanvas: HTMLCanvasElement,
    interactiveCanvas: HTMLCanvasElement,
  ) {
    this.staticCanvas = staticCanvas;
    this.interactiveCanvas = interactiveCanvas;

    const sCtx = staticCanvas.getContext('2d');
    const iCtx = interactiveCanvas.getContext('2d');
    if (!sCtx || !iCtx) {
      throw new Error('Failed to get 2D rendering contexts');
    }
    this.staticCtx = sCtx;
    this.interactiveCtx = iCtx;

    this.roughCanvas = rough.canvas(staticCanvas);
    this.viewport = new ViewportManager();
    this.gridRenderer = new GridRenderer();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  getViewport(): ViewportManager {
    return this.viewport;
  }

  /** Expose the rough canvas for portal rendering on arbitrary contexts. */
  getRoughCanvas(): RoughCanvas {
    return this.roughCanvas;
  }

  /**
   * Redraw the static layer on the next frame. Only the shapes that changed
   * since the last frame are drawn again where possible; `full` redraws them
   * all (for changes the elements don't show, like a font that finished loading).
   */
  private renderLasso(ctx: CanvasRenderingContext2D, path: Point[], zoom: number): void {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(59, 130, 246, 0.06)';
    ctx.fill();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.stroke();
    ctx.restore();
  }

  private renderEraserTrail(ctx: CanvasRenderingContext2D, trail: Point[], zoom: number): void {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#9ca3af';
    // Older parts thinner and fainter
    for (let i = 1; i < trail.length; i++) {
      const age = i / trail.length;
      ctx.globalAlpha = 0.15 + 0.45 * age;
      ctx.lineWidth = (2 + 6 * age) / zoom;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Dark theme on or off: images are drawn to come out right under the canvas's inversion. */
  setDarkMode(dark: boolean): void {
    if (dark === this.darkMode) return;
    this.darkMode = dark;
    this.needsStaticRedraw = true;
    this.needsFullStaticRedraw = true;
    this.wake();
  }

  invalidateStatic(full = false): void {
    this.needsStaticRedraw = true;
    if (full) this.needsFullStaticRedraw = true;
    this.wake();
  }

  /** Force the overlay layer (selection, handles, previews) to repaint. */
  invalidateInteractive(): void {
    this.needsInteractiveRedraw = true;
    this.wake();
  }

  /** The render loop, while it runs; null once stopped. */
  private loop: (() => void) | null = null;
  /** Frames in a row with nothing to draw. */
  private idleFrames = 0;
  /** Two seconds of nothing to draw and the loop stops asking for frames. */
  private static readonly IDLE_FRAMES = 120;

  /**
   * Something may have changed: make sure the loop is running. Cheap to call
   * often (pointer moves, store changes, every render of the canvas).
   */
  wake(): void {
    this.idleFrames = 0;
    if (this.loop && this.animationFrameId === null) {
      this.animationFrameId = requestAnimationFrame(this.loop);
    }
  }

  /** Is the render loop asking for frames (it sleeps when nothing changes)? */
  isAwake(): boolean {
    return this.animationFrameId !== null;
  }

  /**
   * Start the animation-frame render loop.
   *
   * @param getElements - Callback returning the current list of visible elements.
   * @param getState    - Callback returning the current interactive render state.
   */
  startRenderLoop(
    getElements: () => MavisElement[],
    getState: () => RenderState,
  ): void {
    const loop = () => {
      const elements = getElements();
      const state = getState();
      const vp = this.viewport.getViewport();

      const last = this.lastPublishedViewport;
      if (!last || last.zoom !== vp.zoom || last.scrollX !== vp.scrollX || last.scrollY !== vp.scrollY) {
        this.lastPublishedViewport = vp;
        this.onViewportChange?.(vp);
      }

      const viewMoved = this.lastPublishedViewport !== last;
      let staticRedrawn = false;
      if (this.needsStaticRedraw) {
        const t0 = performance.now();
        this.renderStaticLayer(elements, state);
        this.lastStaticMs = performance.now() - t0;
        this.needsStaticRedraw = false;
        staticRedrawn = true;
      }

      // Repaint overlays only when something they depend on changed
      const signature: unknown[] = [
        elements,
        state.selectedIds,
        state.hoveredId,
        state.selectionBox,
        state.creatingElement,
        state.smartGuides,
        state.remoteSelections,
        state.anchorTarget,
        state.hoveredAnchor,
        state.snapTarget,
        state.renderMode,
        vp.zoom,
        vp.scrollX,
        vp.scrollY,
      ];
      const prev = this.lastInteractiveSignature;
      const changed =
        prev.length !== signature.length || signature.some((v, i) => v !== prev[i]);
      const drew = this.needsInteractiveRedraw || staticRedrawn || changed;
      if (drew) {
        this.renderInteractiveLayer(elements, state);
        this.lastInteractiveSignature = signature;
        this.needsInteractiveRedraw = false;
      }

      // Nothing has changed for a while: stop until something wakes the loop
      this.idleFrames = drew || viewMoved ? 0 : this.idleFrames + 1;
      if (this.idleFrames >= CanvasRenderer.IDLE_FRAMES) {
        this.animationFrameId = null;
        return;
      }
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.loop = loop;
    this.viewport.onChange = () => this.wake();
    loop();
  }

  /** Stop the render loop and cancel any pending animation frame. */
  stopRenderLoop(): void {
    this.loop = null;
    this.viewport.onChange = null;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Resize both canvases to the given pixel dimensions.
   * Accounts for device-pixel-ratio for sharp rendering on HiDPI screens.
   */
  resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;

    for (const canvas of [this.staticCanvas, this.interactiveCanvas]) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
    }

    // Roughjs needs to be re-initialized after canvas resize since the
    // underlying canvas dimensions changed.
    this.roughCanvas = rough.canvas(this.staticCanvas);

    this.needsStaticRedraw = true;
    this.needsFullStaticRedraw = true;
    this.needsInteractiveRedraw = true;
    this.wake();
  }

  /** Clean up resources and stop the render loop. */
  destroy(): void {
    this.stopRenderLoop();
    this.imageCache.clear();
    this.layerCache = null;
    this.layerBitmaps = null;
    if (this.releaseLayersTimer) clearTimeout(this.releaseLayersTimer);
    this.releaseLayersTimer = null;
    this.roughByCtx.clear();
  }

  // ---------------------------------------------------------------------------
  // Layer rendering
  // ---------------------------------------------------------------------------

  private renderStaticLayer(
    elements: MavisElement[],
    state: RenderState,
  ): void {
    const { width, height } = this.getLogicalSize(this.staticCanvas);
    const vp = this.viewport.getViewport();

    // Build elements map for elbow routing lookups
    this.elementsMap.clear();
    for (const el of elements) {
      this.elementsMap.set(el.id, el);
    }

    // When only a few shapes changed since last frame (a drag, typing a
    // label) and nothing else did, draw just them: the shapes below and
    // above them in stacking order come from bitmaps (staticLayerPlan.ts)
    const signature: unknown[] = [
      vp.zoom,
      vp.scrollX,
      vp.scrollY,
      this.staticCanvas.width,
      this.staticCanvas.height,
      state.renderMode,
      state.showGrid,
      state.gridSize,
      // Rebuilt on every render of the canvas: compared by what's in it
      portalUsersKey(state.portalActiveUsers),
      state.boundTextElements,
    ];
    const last = this.lastStaticFrame;
    const sameScene =
      !this.needsFullStaticRedraw &&
      !!last &&
      last.signature.length === signature.length &&
      signature.every((v, i) => v === last.signature[i]);
    const changed = sameScene ? changedSince(last.elements, elements) : null;
    this.lastStaticFrame = { signature, elements };
    this.needsFullStaticRedraw = false;

    if (changed && changed.size > 0) {
      const cache = this.layerCache;
      const ids = Array.from(changed);
      const reusable = !!cache && ids.every((id) => cache.hot.has(id));
      // Still the same edit: keep its shapes live; a new one elsewhere starts afresh
      const continues = !!cache && ids.some((id) => cache.hot.has(id));
      const hot = reusable ? cache.hot : new Set([...(continues ? cache.hot : []), ...ids]);
      const span = reusable ? cache.span : liveSpan(elements, hot);
      if (span) {
        if (!reusable) this.buildLayerCache(elements, state, hot, span, width, height);
        this.drawWithLayerCache(elements, state, width, height);
        this.lastStaticPath = reusable ? 'cached' : 'build';
        this.releaseLayersLater();
        return;
      }
    }

    // Everything
    this.layerCache = null;
    this.lastStaticPath = 'full';
    this.lastDrawnCount = this.drawStaticRange(
      this.staticCtx,
      elements,
      state,
      0,
      elements.length - 1,
      width,
      height,
      true,
    );
  }

  /**
   * Draw elements[from..to] that are on screen into `ctx`, under the
   * viewport transform. `background`: clear first and draw the grid.
   * Returns how many were drawn.
   */
  private drawStaticRange(
    ctx: CanvasRenderingContext2D,
    elements: MavisElement[],
    state: RenderState,
    from: number,
    to: number,
    width: number,
    height: number,
    background: boolean,
  ): number {
    const vp = this.viewport.getViewport();
    if (background) ctx.clearRect(0, 0, width, height);

    // Apply viewport transform
    ctx.save();
    ctx.translate(vp.scrollX, vp.scrollY);
    ctx.scale(vp.zoom, vp.zoom);

    // Draw grid
    if (background) {
      this.gridRenderer.render(ctx, vp, width, height, state.gridSize, state.showGrid);
    }

    // Draw each committed element that intersects the visible area
    const margin = 64 / vp.zoom;
    const viewLeft = -vp.scrollX / vp.zoom - margin;
    const viewTop = -vp.scrollY / vp.zoom - margin;
    const viewRight = viewLeft + width / vp.zoom + margin * 2;
    const viewBottom = viewTop + height / vp.zoom + margin * 2;
    let drawn = 0;

    for (let i = Math.max(0, from); i <= to && i < elements.length; i++) {
      const element = elements[i];
      const b = elementWorldBounds(element);
      if (b.maxX < viewLeft || b.minX > viewRight || b.maxY < viewTop || b.minY > viewBottom) {
        continue;
      }
      drawn++;
      this.renderElement(ctx, element, state.renderMode, state.portalActiveUsers);

      // Render bound text for shape elements
      if (state.boundTextElements && element.boundElements) {
        for (const bound of element.boundElements) {
          if (bound.type === 'text') {
            const textEl = state.boundTextElements.get(bound.id);
            if (textEl && !textEl.isDeleted) {
              this.renderElement(ctx, textEl, state.renderMode);
            }
          }
        }
      }
    }

    ctx.restore();
    return drawn;
  }

  /** The two bitmaps, sized like the static canvas (made on first use). */
  /**
   * The bitmaps only pay off while something is being dragged: a few
   * seconds after the last frame that used them, they're freed (the next
   * drag makes them again).
   */
  private releaseLayersLater(): void {
    if (this.releaseLayersTimer) clearTimeout(this.releaseLayersTimer);
    this.releaseLayersTimer = setTimeout(() => {
      this.releaseLayersTimer = null;
      this.layerCache = null;
      this.layerBitmaps = null;
    }, LAYER_KEEP_MS);
  }

  private bitmaps(): { below: LayerBitmap; above: LayerBitmap } {
    const make = (): LayerBitmap => {
      const canvas = document.createElement('canvas');
      return { canvas, ctx: canvas.getContext('2d')!, rough: rough.canvas(canvas) };
    };
    this.layerBitmaps ??= { below: make(), above: make() };
    const dpr = window.devicePixelRatio || 1;
    for (const bitmap of [this.layerBitmaps.below, this.layerBitmaps.above]) {
      if (
        bitmap.canvas.width !== this.staticCanvas.width ||
        bitmap.canvas.height !== this.staticCanvas.height
      ) {
        bitmap.canvas.width = this.staticCanvas.width;
        bitmap.canvas.height = this.staticCanvas.height;
        bitmap.rough = rough.canvas(bitmap.canvas);
      }
      bitmap.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.roughByCtx.set(bitmap.ctx, bitmap.rough);
    }
    return this.layerBitmaps;
  }

  /** Draw what's below and above the span of changing shapes into the bitmaps. */
  private buildLayerCache(
    elements: MavisElement[],
    state: RenderState,
    hot: Set<string>,
    span: LivePlan,
    width: number,
    height: number,
  ): void {
    const { below, above } = this.bitmaps();
    const drawnBelow = this.drawStaticRange(
      below.ctx,
      elements,
      state,
      0,
      span.from - 1,
      width,
      height,
      true,
    );
    above.ctx.clearRect(0, 0, width, height);
    const drawnAbove = this.drawStaticRange(
      above.ctx,
      elements,
      state,
      span.to + 1,
      elements.length - 1,
      width,
      height,
      false,
    );
    this.layerCache = { hot, span, drawnOutside: drawnBelow + drawnAbove };
  }

  /** Below bitmap, the changing span drawn live, above bitmap. */
  private drawWithLayerCache(
    elements: MavisElement[],
    state: RenderState,
    width: number,
    height: number,
  ): void {
    const cache = this.layerCache!;
    const { below, above } = this.layerBitmaps!;
    const ctx = this.staticCtx;
    const blit = (bitmap: LayerBitmap) => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(bitmap.canvas, 0, 0);
      ctx.restore();
    };
    ctx.clearRect(0, 0, width, height);
    blit(below);
    const live = this.drawStaticRange(
      ctx,
      elements,
      state,
      cache.span.from,
      cache.span.to,
      width,
      height,
      false,
    );
    blit(above);
    this.lastDrawnCount = cache.drawnOutside + live;
  }

  private renderInteractiveLayer(
    elements: MavisElement[],
    state: RenderState,
  ): void {
    const ctx = this.interactiveCtx;
    const { width, height } = this.getLogicalSize(this.interactiveCanvas);
    const vp = this.viewport.getViewport();

    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(vp.scrollX, vp.scrollY);
    ctx.scale(vp.zoom, vp.zoom);

    // The lasso: the loop drawn so far, closed back to where it started
    if (state.lassoPath && state.lassoPath.length > 1) {
      this.renderLasso(ctx, state.lassoPath, vp.zoom);
    }

    // The eraser's trail: a short, fading stroke behind the pointer
    if (state.eraserTrail && state.eraserTrail.length > 1) {
      this.renderEraserTrail(ctx, state.eraserTrail, vp.zoom);
    }

    // Hover highlight
    if (state.hoveredId && !state.selectedIds.has(state.hoveredId)) {
      const hoveredEl = elements.find((e) => e.id === state.hoveredId);
      if (hoveredEl) {
        this.renderHoverHighlight(ctx, hoveredEl);
      }
    }

    // Selected element outlines + handles
    if (state.selectedIds.size > 0) {
      const selectedElements = elements.filter((e) =>
        state.selectedIds.has(e.id),
      );
      // Same frame the InteractionManager hit-tests its handles against
      const frame = selectionFrame(selectedElements);
      if (frame) {
        const bounds = frame.bounds;
        ctx.save();
        if (frame.angle) {
          // A single rotated shape: the frame and its handles turn with it
          const cx = bounds.x + bounds.width / 2;
          const cy = bounds.y + bounds.height / 2;
          ctx.translate(cx, cy);
          ctx.rotate(frame.angle);
          ctx.translate(-cx, -cy);
        }
        this.renderSelectionBox(ctx, bounds);
        if (selectedElements.some((e) => e.isLocked)) {
          this.renderLockBadge(ctx, bounds);
        } else {
          this.renderResizeHandles(ctx, bounds);
          this.renderRotationHandle(ctx, bounds);
        }
        ctx.restore();
      }
    }

    // Remote user selections (soft-lock borders)
    if (state.remoteSelections && state.remoteSelections.length > 0) {
      for (const remote of state.remoteSelections) {
        for (const elementId of remote.elementIds) {
          const el = elements.find((e) => e.id === elementId);
          if (el) {
            this.renderRemoteSelectionBorder(ctx, el, remote.color, remote.userName);
          }
        }
      }
    }

    // Selection marquee rectangle
    if (state.selectionBox) {
      this.renderMarquee(ctx, state.selectionBox);
    }

    // Element being created (live preview)
    if (state.creatingElement) {
      this.renderElement(ctx, state.creatingElement, state.renderMode);
    }

    // Smart guides
    if (state.smartGuides && state.smartGuides.length > 0) {
      this.renderSmartGuides(ctx, state.smartGuides);
    }

    // Anchor point indicators (Phase 3)
    if (state.anchorTarget && !state.anchorTarget.isDeleted) {
      this.renderAnchorPoints(ctx, state.anchorTarget, state.hoveredAnchor ?? null);
    }

    // Snap target highlight (Phase 3)
    if (state.snapTarget) {
      this.renderSnapFeedback(ctx, state.snapTarget.element, state.snapTarget.anchor);
    }

    // Endpoint handles for selected linear elements (Phase 4)
    if (state.selectedIds.size > 0) {
      for (const el of elements) {
        if (state.selectedIds.has(el.id) && (el.type === 'arrow' || el.type === 'line') && !el.isDeleted) {
          const linear = el as LinearElement;
          this.renderLinearEndpointHandles(ctx, linear);
          if (linear.routingMode === 'elbow') {
            this.renderElbowSegmentHandles(ctx, linear);
          } else {
            this.renderWaypointHandles(ctx, linear);
            this.renderMidpointAddHandles(ctx, linear);
          }
        }
      }
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Element rendering
  // ---------------------------------------------------------------------------

  /**
   * Render a single element on the given context.
   * Applies the element's position, rotation, and opacity before dispatching
   * to the shape-specific renderer.
   */
  /**
   * Give the renderer the full element set for lookups (elbow routing,
   * connector labels). The static pass does this itself; exports call it.
   */
  setElementsContext(elements: MavisElement[]): void {
    this.elementsMap.clear();
    for (const el of elements) this.elementsMap.set(el.id, el);
  }

  renderElement(
    ctx: CanvasRenderingContext2D,
    element: MavisElement,
    renderMode: RenderMode,
    portalActiveUsers?: Map<string, number>,
  ): void {
    // Connector labels are positioned by their connector, not by themselves
    if (element.type === 'text' && element.containerId) {
      const container = this.elementsMap.get(element.containerId);
      if (container && (container.type === 'arrow' || container.type === 'line')) {
        this.renderConnectorLabel(ctx, element as TextElement, container as LinearElement);
        return;
      }
    }

    ctx.save();

    // Transform: translate to element center, rotate, translate back to origin
    ctx.translate(
      element.x + element.width / 2,
      element.y + element.height / 2,
    );
    ctx.rotate(element.angle);
    ctx.translate(-element.width / 2, -element.height / 2);
    ctx.globalAlpha = element.opacity / 100;

    // Cache rough drawables for elements whose shape depends only on
    // themselves. An elbow route also depends on the shapes it joins: its
    // drawables are kept while the (cached) route is the same one
    const isElbow =
      (element.type === 'arrow' || element.type === 'line') &&
      (element as LinearElement).routingMode === 'elbow';
    if (isElbow && renderMode === 'sketchy') {
      const route = this.getElbowPointsForElement(element as LinearElement);
      if (this.roughRouteFor.get(element) !== route) {
        this.roughCache.delete(element);
        this.roughRouteFor.set(element, route);
      }
    }
    const dependsOnOthers = element.type === 'portal';
    this.cacheElement = renderMode === 'sketchy' && !dependsOnOthers ? element : null;
    this.cachePart = 0;

    switch (element.type) {
      case 'rectangle':
        this.renderRectangle(ctx, element, renderMode);
        break;
      case 'ellipse':
        this.renderEllipse(ctx, element, renderMode);
        break;
      case 'diamond':
        this.renderDiamond(ctx, element, renderMode);
        break;
      case 'triangle':
        this.renderTriangle(ctx, element, renderMode);
        break;
      case 'cylinder':
      case 'queue':
        this.renderCurvedEnds(ctx, element, renderMode);
        break;
      case 'line':
      case 'arrow':
      case 'freedraw':
        this.renderLinear(ctx, element as LinearElement, renderMode);
        break;
      case 'text':
        this.renderText(ctx, element as TextElement);
        break;
      case 'portal': {
        const portal = element as PortalElement;
        const activeCount = portalActiveUsers?.get(portal.targetDiagramId) ?? 0;
        if (renderMode === 'sketchy') {
          renderPortalSketchy(ctx, this.roughCanvas, portal, (c, drawable) => {
            this.drawRoughShape(c, () => drawable);
          }, activeCount);
        } else {
          renderPortalClean(ctx, portal, activeCount);
        }
        break;
      }
      case 'image':
        this.renderImage(ctx, element as ImageElement);
        break;
      default:
        this.renderRectangle(ctx, element as unknown as RectangleElement, renderMode);
        break;
    }

    if (element.icon) this.renderIcon(ctx, element);

    this.cacheElement = null;
    ctx.restore();
  }

  /** Icons as Path2D, made once per icon. */
  private iconPaths = new Map<string, Path2D[]>();

  /** The shape's icon (top left, or top centre for round shapes), in its stroke colour. */
  private renderIcon(ctx: CanvasRenderingContext2D, element: MavisElement): void {
    if (
      element.type === 'text' ||
      element.type === 'arrow' ||
      element.type === 'line' ||
      element.type === 'freedraw'
    ) {
      return;
    }
    const def = iconById(element.icon);
    const at = def && iconPlacement(element);
    if (!def || !at) return;
    let paths = this.iconPaths.get(element.icon!);
    if (!paths) {
      paths = def.paths.map((d) => new Path2D(d));
      this.iconPaths.set(element.icon!, paths);
    }
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.scale(at.size / 24, at.size / 24);
    ctx.strokeStyle = element.strokeColor;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    for (const path of paths) ctx.stroke(path);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Shape renderers — Sketchy (Rough.js) & Clean (Path2D)
  // ---------------------------------------------------------------------------

  private renderRectangle(
    ctx: CanvasRenderingContext2D,
    element: MavisElement,
    renderMode: RenderMode,
  ): void {
    const { width, height, strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle } = element;
    const roundness = (element as RectangleElement).roundness ?? 0;

    if (renderMode === 'sketchy') {
      this.drawRoughShape(ctx, () => {
        const options = this.buildRoughOptions(element);
        return this.roughCanvas.generator.rectangle(0, 0, width, height, options);
      });
    } else {
      this.applyCleanStroke(ctx, strokeColor, strokeWidth, strokeStyle);

      if (roundness > 0) {
        // Use roundRect for rounded corners
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, roundness);
      } else {
        ctx.beginPath();
        ctx.rect(0, 0, width, height);
      }

      if (backgroundColor !== 'transparent' && fillStyle !== 'none') {
        ctx.fillStyle = backgroundColor;
        ctx.fill();
      }
      if (strokeWidth > 0) {
        ctx.stroke();
      }
    }
  }

  private renderEllipse(
    ctx: CanvasRenderingContext2D,
    element: MavisElement,
    renderMode: RenderMode,
  ): void {
    const { width, height, strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle } = element;

    if (renderMode === 'sketchy') {
      this.drawRoughShape(ctx, () => {
        const options = this.buildRoughOptions(element);
        // Rough.js ellipse is centered at (cx, cy) with width and height
        return this.roughCanvas.generator.ellipse(
          width / 2,
          height / 2,
          width,
          height,
          options,
        );
      });
    } else {
      this.applyCleanStroke(ctx, strokeColor, strokeWidth, strokeStyle);

      ctx.beginPath();
      ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);

      if (backgroundColor !== 'transparent' && fillStyle !== 'none') {
        ctx.fillStyle = backgroundColor;
        ctx.fill();
      }
      if (strokeWidth > 0) {
        ctx.stroke();
      }
    }
  }

  private renderDiamond(
    ctx: CanvasRenderingContext2D,
    element: MavisElement,
    renderMode: RenderMode,
  ): void {
    const { width, height, strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle } = element;

    // Diamond: midpoint of each side
    const points: [number, number][] = [
      [width / 2, 0],
      [width, height / 2],
      [width / 2, height],
      [0, height / 2],
    ];

    if (renderMode === 'sketchy') {
      this.drawRoughShape(ctx, () => {
        const options = this.buildRoughOptions(element);
        return this.roughCanvas.generator.polygon(points, options);
      });
    } else {
      this.applyCleanStroke(ctx, strokeColor, strokeWidth, strokeStyle);

      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.closePath();

      if (backgroundColor !== 'transparent' && fillStyle !== 'none') {
        ctx.fillStyle = backgroundColor;
        ctx.fill();
      }
      if (strokeWidth > 0) {
        ctx.stroke();
      }
    }
  }

  private renderTriangle(
    ctx: CanvasRenderingContext2D,
    element: MavisElement,
    renderMode: RenderMode,
  ): void {
    const { width, height, strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle } = element;

    const points: [number, number][] = [
      [width / 2, 0],
      [width, height],
      [0, height],
    ];

    if (renderMode === 'sketchy') {
      this.drawRoughShape(ctx, () => {
        const options = this.buildRoughOptions(element);
        return this.roughCanvas.generator.polygon(points, options);
      });
    } else {
      this.applyCleanStroke(ctx, strokeColor, strokeWidth, strokeStyle);

      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.closePath();

      if (backgroundColor !== 'transparent' && fillStyle !== 'none') {
        ctx.fillStyle = backgroundColor;
        ctx.fill();
      }
      if (strokeWidth > 0) {
        ctx.stroke();
      }
    }
  }

  /** Datastores (cylinder) and queues (a cylinder on its side): outline, then the visible rim. */
  private renderCurvedEnds(
    ctx: CanvasRenderingContext2D,
    element: MavisElement,
    renderMode: RenderMode,
  ): void {
    const { width, height, strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle } =
      element;
    const { body, rim } =
      element.type === 'cylinder' ? cylinderPaths(width, height) : queuePaths(width, height);

    if (renderMode === 'sketchy') {
      this.drawRoughShape(ctx, () =>
        this.roughCanvas.generator.path(body, this.buildRoughOptions(element)),
      );
      this.drawRoughShape(ctx, () => {
        const options = this.buildRoughOptions(element);
        delete options.fill;
        delete options.fillStyle;
        return this.roughCanvas.generator.path(rim, options);
      });
      return;
    }
    this.applyCleanStroke(ctx, strokeColor, strokeWidth, strokeStyle);
    const outline = new Path2D(body);
    if (backgroundColor !== 'transparent' && fillStyle !== 'none') {
      ctx.fillStyle = backgroundColor;
      ctx.fill(outline);
    }
    if (strokeWidth > 0) {
      ctx.stroke(outline);
      ctx.stroke(new Path2D(rim));
    }
  }

  private renderLinear(
    ctx: CanvasRenderingContext2D,
    element: LinearElement,
    renderMode: RenderMode,
  ): void {
    const { points, strokeColor, strokeWidth, strokeStyle, type, routingMode } = element;

    if (!points || points.length < 2) return;

    // Choose rendering based on routing mode
    if (type === 'freedraw') {
      this.renderFreedraw(ctx, element, renderMode);
    } else if (routingMode === 'curved') {
      this.renderCurvedLine(ctx, element, renderMode);
    } else if (routingMode === 'elbow') {
      this.renderElbowLine(ctx, element, renderMode);
    } else {
      this.renderStraightLine(ctx, element, renderMode);
    }

    // Draw arrowheads for arrow elements
    if (type === 'arrow') {
      this.renderArrowheads(ctx, element, renderMode);
    }
  }

  private renderStraightLine(
    ctx: CanvasRenderingContext2D,
    element: LinearElement,
    renderMode: RenderMode,
  ): void {
    const { points, strokeColor, strokeWidth, strokeStyle } = element;

    if (renderMode === 'sketchy') {
      this.drawRoughShape(ctx, () => {
        const options = this.buildRoughOptions(element);
        delete options.fill;
        delete options.fillStyle;
        return this.roughCanvas.generator.linearPath(
          points as [number, number][],
          options,
        );
      });
    } else {
      this.applyCleanStroke(ctx, strokeColor, strokeWidth, strokeStyle);

      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.stroke();
    }
  }

  private renderCurvedLine(
    ctx: CanvasRenderingContext2D,
    element: LinearElement,
    renderMode: RenderMode,
  ): void {
    const { points, strokeColor, strokeWidth, strokeStyle } = element;

    if (points.length < 2) return;

    if (points.length === 2) {
      const start: Point = { x: points[0][0], y: points[0][1] };
      const end: Point = { x: points[1][0], y: points[1][1] };
      const [, cp1, cp2] = getCubicControlPoints(start, end, 0.5);

      if (renderMode === 'sketchy') {
        this.drawRoughShape(ctx, () => {
          const options = this.buildRoughOptions(element);
          delete options.fill;
          delete options.fillStyle;
          const curvePoints: [number, number][] = [
            [start.x, start.y],
            [cp1.x, cp1.y],
            [cp2.x, cp2.y],
            [end.x, end.y],
          ];
          return this.roughCanvas.generator.curve(curvePoints, options);
        });
      } else {
        this.applyCleanStroke(ctx, strokeColor, strokeWidth, strokeStyle);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
        ctx.stroke();
      }
      return;
    }

    // Multiple points: render piecewise smooth cubic bezier through all points
    const pts: Point[] = points.map(([px, py]) => ({ x: px, y: py }));
    const segments = this.computeSmoothCurveSegments(pts);

    if (renderMode === 'sketchy') {
      this.drawRoughShape(ctx, () => {
        const options = this.buildRoughOptions(element);
        delete options.fill;
        delete options.fillStyle;
        const curvePoints: [number, number][] = [[pts[0].x, pts[0].y]];
        for (const seg of segments) {
          curvePoints.push([seg.cp1.x, seg.cp1.y]);
          curvePoints.push([seg.cp2.x, seg.cp2.y]);
          curvePoints.push([seg.end.x, seg.end.y]);
        }
        return this.roughCanvas.generator.curve(curvePoints, options);
      });
    } else {
      this.applyCleanStroke(ctx, strokeColor, strokeWidth, strokeStyle);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const seg of segments) {
        ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.end.x, seg.end.y);
      }
      ctx.stroke();
    }
  }

  /**
   * Compute smooth cubic bezier segments through an ordered list of points
   * using Catmull-Rom-style tangent estimation.
   */
  private computeSmoothCurveSegments(
    pts: Point[],
  ): { cp1: Point; cp2: Point; end: Point }[] {
    const n = pts.length;
    if (n < 2) return [];

    const tension = 0.35;
    const tangents: Point[] = [];
    for (let i = 0; i < n; i++) {
      if (i === 0) {
        tangents.push({ x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y });
      } else if (i === n - 1) {
        tangents.push({ x: pts[n - 1].x - pts[n - 2].x, y: pts[n - 1].y - pts[n - 2].y });
      } else {
        tangents.push({
          x: (pts[i + 1].x - pts[i - 1].x) / 2,
          y: (pts[i + 1].y - pts[i - 1].y) / 2,
        });
      }
    }

    const segments: { cp1: Point; cp2: Point; end: Point }[] = [];
    for (let i = 0; i < n - 1; i++) {
      segments.push({
        cp1: {
          x: pts[i].x + tangents[i].x * tension,
          y: pts[i].y + tangents[i].y * tension,
        },
        cp2: {
          x: pts[i + 1].x - tangents[i + 1].x * tension,
          y: pts[i + 1].y - tangents[i + 1].y * tension,
        },
        end: pts[i + 1],
      });
    }
    return segments;
  }

  private renderElbowLine(
    ctx: CanvasRenderingContext2D,
    element: LinearElement,
    renderMode: RenderMode,
  ): void {
    const { points, strokeColor, strokeWidth, strokeStyle } = element;

    if (points.length < 2) return;

    // Calculate elbow routing with anchor-aware directions
    const elbowPoints = this.getElbowPointsForElement(element);

    if (renderMode === 'sketchy') {
      this.drawRoughShape(ctx, () => {
        const options = this.buildRoughOptions(element);
        delete options.fill;
        delete options.fillStyle;
        return this.roughCanvas.generator.linearPath(elbowPoints, options);
      });
    } else {
      this.applyCleanStroke(ctx, strokeColor, strokeWidth, strokeStyle);

      ctx.beginPath();
      ctx.moveTo(elbowPoints[0][0], elbowPoints[0][1]);
      for (let i = 1; i < elbowPoints.length; i++) {
        ctx.lineTo(elbowPoints[i][0], elbowPoints[i][1]);
      }
      ctx.stroke();
    }
  }

  /**
   * An elbow connector's route in element-local points (shared with hit
   * testing, and cached there per connector and the shapes it joins).
   */
  private getElbowPointsForElement(element: LinearElement): [number, number][] {
    return computeElbowPoints(element, this.elementsMap);
  }

  private renderFreedraw(
    ctx: CanvasRenderingContext2D,
    element: LinearElement,
    renderMode: RenderMode,
  ): void {
    const { points, strokeColor, strokeWidth, strokeStyle } = element;

    if (renderMode === 'sketchy') {
      this.drawRoughShape(ctx, () => {
        const options = this.buildRoughOptions(element);
        delete options.fill;
        delete options.fillStyle;

        if (points.length > 2) {
          return this.roughCanvas.generator.curve(
            points as [number, number][],
            options,
          );
        } else {
          return this.roughCanvas.generator.linearPath(
            points as [number, number][],
            options,
          );
        }
      });
    } else {
      this.applyCleanStroke(ctx, strokeColor, strokeWidth, strokeStyle);

      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);

      if (points.length > 2) {
        // Smooth curve through freedraw points using quadratic bezier
        for (let i = 1; i < points.length - 1; i++) {
          const midX = (points[i][0] + points[i + 1][0]) / 2;
          const midY = (points[i][1] + points[i + 1][1]) / 2;
          ctx.quadraticCurveTo(points[i][0], points[i][1], midX, midY);
        }
        // Final segment to last point
        const last = points[points.length - 1];
        ctx.lineTo(last[0], last[1]);
      } else {
        // Straight line segments
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i][0], points[i][1]);
        }
      }

      ctx.stroke();
    }
  }

  private renderArrowheads(
    ctx: CanvasRenderingContext2D,
    element: LinearElement,
    _renderMode: RenderMode,
  ): void {
    const { points, strokeColor, strokeWidth, startArrowhead, endArrowhead, routingMode } = element;
    if (!points || points.length < 2) return;

    const arrowLength = Math.max(10, strokeWidth * 4);
    const arrowAngle = Math.PI / 6; // 30 degrees

    ctx.fillStyle = strokeColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.setLineDash([]);

    // For elbow routing, use the last segment direction
    if (routingMode === 'elbow') {
      const elbowPoints = this.getElbowPointsForElement(element);

      if (endArrowhead !== 'none') {
        const last = elbowPoints[elbowPoints.length - 1];
        const prev = elbowPoints[elbowPoints.length - 2];
        const angle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
        this.drawArrowhead(ctx, last[0], last[1], angle, arrowLength, arrowAngle, endArrowhead);
      }

      if (startArrowhead !== 'none') {
        const first = elbowPoints[0];
        const next = elbowPoints[1];
        const angle = Math.atan2(first[1] - next[1], first[0] - next[0]);
        this.drawArrowhead(ctx, first[0], first[1], angle, arrowLength, arrowAngle, startArrowhead);
      }
      return;
    }

    // For curved routing, compute tangent at endpoint
    if (routingMode === 'curved') {
      const pts: Point[] = points.map(([px, py]) => ({ x: px, y: py }));

      if (pts.length === 2) {
        const [, cp1, cp2] = getCubicControlPoints(pts[0], pts[1], 0.5);
        if (endArrowhead !== 'none') {
          const angle = Math.atan2(pts[1].y - cp2.y, pts[1].x - cp2.x);
          this.drawArrowhead(ctx, pts[1].x, pts[1].y, angle, arrowLength, arrowAngle, endArrowhead);
        }
        if (startArrowhead !== 'none') {
          const angle = Math.atan2(pts[0].y - cp1.y, pts[0].x - cp1.x);
          this.drawArrowhead(ctx, pts[0].x, pts[0].y, angle, arrowLength, arrowAngle, startArrowhead);
        }
      } else {
        const segments = this.computeSmoothCurveSegments(pts);
        if (endArrowhead !== 'none' && segments.length > 0) {
          const lastSeg = segments[segments.length - 1];
          const angle = Math.atan2(lastSeg.end.y - lastSeg.cp2.y, lastSeg.end.x - lastSeg.cp2.x);
          this.drawArrowhead(ctx, lastSeg.end.x, lastSeg.end.y, angle, arrowLength, arrowAngle, endArrowhead);
        }
        if (startArrowhead !== 'none' && segments.length > 0) {
          const firstSeg = segments[0];
          const angle = Math.atan2(pts[0].y - firstSeg.cp1.y, pts[0].x - firstSeg.cp1.x);
          this.drawArrowhead(ctx, pts[0].x, pts[0].y, angle, arrowLength, arrowAngle, startArrowhead);
        }
      }
      return;
    }

    // End arrowhead (straight)
    if (endArrowhead !== 'none') {
      const last = points[points.length - 1];
      const prev = points[points.length - 2];
      const angle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
      this.drawArrowhead(ctx, last[0], last[1], angle, arrowLength, arrowAngle, endArrowhead);
    }

    // Start arrowhead
    if (startArrowhead !== 'none') {
      const first = points[0];
      const next = points[1];
      const angle = Math.atan2(first[1] - next[1], first[0] - next[0]);
      this.drawArrowhead(ctx, first[0], first[1], angle, arrowLength, arrowAngle, startArrowhead);
    }
  }

  private drawArrowhead(
    ctx: CanvasRenderingContext2D,
    tipX: number,
    tipY: number,
    angle: number,
    length: number,
    spread: number,
    type: string,
  ): void {
    const x1 = tipX - length * Math.cos(angle - spread);
    const y1 = tipY - length * Math.sin(angle - spread);
    const x2 = tipX - length * Math.cos(angle + spread);
    const y2 = tipY - length * Math.sin(angle + spread);

    switch (type) {
      case 'arrow':
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        break;
      case 'triangle':
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(x2, y2);
        ctx.closePath();
        ctx.fill();
        break;
      case 'dot': {
        const radius = length / 2;
        ctx.beginPath();
        ctx.arc(
          tipX - (radius * Math.cos(angle)),
          tipY - (radius * Math.sin(angle)),
          radius,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        break;
      }
      case 'bar':
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        break;
    }
  }

  private renderText(
    ctx: CanvasRenderingContext2D,
    element: TextElement,
  ): void {
    const {
      text,
      fontSize,
      fontFamily,
      textAlign,
      strokeColor,
      width,
      height,
      lineHeight,
      containerId,
    } = element;

    if (!text) return;

    ctx.font = cssFont(fontSize, fontFamily);
    ctx.fillStyle = strokeColor;
    ctx.textAlign = textAlign;
    ctx.textBaseline = 'top';

    // For container-bound text, wrap within bounds
    const maxWidth = containerId ? width : undefined;
    const lines = maxWidth ? this.wrapText(ctx, text, maxWidth) : text.split('\n');
    const lineHeightPx = fontSize * lineHeight;

    // Compute vertical starting position based on verticalAlign
    const totalTextHeight = lines.length * lineHeightPx;
    let startY: number;
    switch (element.verticalAlign) {
      case 'middle':
        startY = (height - totalTextHeight) / 2;
        break;
      case 'bottom':
        startY = height - totalTextHeight;
        break;
      case 'top':
      default:
        startY = 0;
    }

    // Horizontal anchor
    let anchorX: number;
    switch (textAlign) {
      case 'center':
        anchorX = width / 2;
        break;
      case 'right':
        anchorX = width;
        break;
      case 'left':
      default:
        anchorX = 0;
    }

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], anchorX, startY + i * lineHeightPx);
    }
  }

  /**
   * Draw a connector's label centred on the route's visual midpoint, on a
   * knockout so the line doesn't strike through the text.
   */
  private renderConnectorLabel(
    ctx: CanvasRenderingContext2D,
    label: TextElement,
    connector: LinearElement,
  ): void {
    if (!label.text) return;
    const mid = this.connectorMidpoint(connector);
    const lines = label.text.split('\n');
    const lineHeightPx = label.fontSize * label.lineHeight;

    ctx.save();
    ctx.font = cssFont(label.fontSize, label.fontFamily);
    ctx.globalAlpha = label.opacity / 100;
    let width = 0;
    for (const line of lines) width = Math.max(width, ctx.measureText(line).width);
    const height = lines.length * lineHeightPx;
    const padX = 6;
    const padY = 2;

    ctx.fillStyle = this.labelBackground;
    ctx.beginPath();
    ctx.roundRect(mid.x - width / 2 - padX, mid.y - height / 2 - padY, width + padX * 2, height + padY * 2, 4);
    ctx.fill();

    ctx.fillStyle = label.strokeColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(line, mid.x, mid.y - height / 2 + i * lineHeightPx);
    });
    ctx.restore();
  }

  /** Background drawn behind connector labels (the canvas colour). */
  labelBackground = '#ffffff';

  /** Midpoint of the route as drawn (elbow and curved routes included). */
  private connectorMidpoint(el: LinearElement): Point {
    const pts = el.points;
    if (el.routingMode === 'elbow') {
      return polylineMidpoint(el.x, el.y, this.getElbowPointsForElement(el));
    }
    if (el.routingMode === 'curved' && pts.length === 2) {
      const start = { x: pts[0][0], y: pts[0][1] };
      const end = { x: pts[1][0], y: pts[1][1] };
      const [, cp1, cp2] = getCubicControlPoints(start, end, 0.5);
      // Cubic Bézier at t = 0.5
      return {
        x: el.x + (start.x + 3 * cp1.x + 3 * cp2.x + end.x) / 8,
        y: el.y + (start.y + 3 * cp1.y + 3 * cp2.y + end.y) / 8,
      };
    }
    return polylineMidpoint(el.x, el.y, pts);
  }

  /**
   * Word-wrap text to fit within maxWidth.
   */
  /** Wrapped label lines by font, width and text: measuring every frame was most of a pan. */
  private wrapCache = new Map<string, string[]>();

  /** Fonts changed (a web font finished loading): wrapped widths are stale. */
  clearTextLayoutCache(): void {
    this.wrapCache.clear();
  }

  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
  ): string[] {
    const cacheKey = `${ctx.font}\u0000${maxWidth}\u0000${text}`;
    const cached = this.wrapCache.get(cacheKey);
    if (cached) return cached;
    const lines = this.measureWrap(ctx, text, maxWidth);
    if (this.wrapCache.size >= 10_000) this.wrapCache.clear();
    this.wrapCache.set(cacheKey, lines);
    return lines;
  }

  private measureWrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const paragraphs = text.split('\n');
    const lines: string[] = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.split(' ');
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const metrics = ctx.measureText(testLine);

        if (metrics.width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      lines.push(currentLine);
    }

    return lines;
  }

  /**
   * Render an image element on the canvas.
   */
  private renderImage(
    ctx: CanvasRenderingContext2D,
    element: ImageElement,
  ): void {
    const { width, height, imageUrl, strokeColor, strokeWidth } = element;

    if (!imageUrl) {
      // Placeholder rectangle if no image loaded
      ctx.save();
      ctx.strokeStyle = strokeColor || '#999999';
      ctx.lineWidth = strokeWidth || 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(0, 0, width, height);

      // Draw X
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(width, height);
      ctx.moveTo(width, 0);
      ctx.lineTo(0, height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    // Try to get from cache or create new image
    let img = this.imageCache.get(imageUrl);
    if (!img) {
      img = new Image();
      img.src = imageUrl;
      this.imageCache.set(imageUrl, img);

      // Trigger redraw when image loads
      img.onload = () => {
        this.needsStaticRedraw = true;
        // It may be in a cached bitmap: draw everything again
        this.needsFullStaticRedraw = true;
        this.wake();
      };
    }

    if (img.complete && img.naturalWidth > 0) {
      if (this.darkMode) {
        // Inverted here, inverted back by the dark theme: a photo stays a photo
        ctx.save();
        ctx.filter = 'invert(100%) hue-rotate(180deg)';
        ctx.drawImage(img, 0, 0, width, height);
        ctx.restore();
      } else {
        ctx.drawImage(img, 0, 0, width, height);
      }
    } else {
      // Draw placeholder while loading
      ctx.save();
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, width, height);
      ctx.fillStyle = '#999999';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Loading...', width / 2, height / 2);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // Smart Guides rendering
  // ---------------------------------------------------------------------------

  /**
   * Alignment guides: a thin line through every aligned shape with a small
   * cross on each aligned point (Excalidraw). Equal spacing: the matching
   * gaps with end ticks and their distance (Figma, Miro).
   */
  private renderSmartGuides(
    ctx: CanvasRenderingContext2D,
    guides: SmartGuide[],
  ): void {
    const zoom = this.viewport.getViewport().zoom;
    const px = 1 / zoom;
    const cross = 3 * px;
    const tick = 4 * px;

    ctx.save();
    ctx.strokeStyle = CanvasRenderer.SMART_GUIDE_COLOR;
    ctx.fillStyle = CanvasRenderer.SMART_GUIDE_COLOR;
    ctx.lineWidth = px;
    ctx.setLineDash([]);

    for (const guide of guides) {
      ctx.beginPath();
      if (guide.kind === 'align') {
        if (guide.axis === 'x') {
          ctx.moveTo(guide.position, guide.start);
          ctx.lineTo(guide.position, guide.end);
        } else {
          ctx.moveTo(guide.start, guide.position);
          ctx.lineTo(guide.end, guide.position);
        }
        for (const m of guide.marks) {
          ctx.moveTo(m.x - cross, m.y - cross);
          ctx.lineTo(m.x + cross, m.y + cross);
          ctx.moveTo(m.x + cross, m.y - cross);
          ctx.lineTo(m.x - cross, m.y + cross);
        }
        ctx.stroke();
        continue;
      }

      for (const seg of guide.segments) {
        if (guide.axis === 'x') {
          ctx.moveTo(seg.from, seg.at);
          ctx.lineTo(seg.to, seg.at);
          ctx.moveTo(seg.from, seg.at - tick);
          ctx.lineTo(seg.from, seg.at + tick);
          ctx.moveTo(seg.to, seg.at - tick);
          ctx.lineTo(seg.to, seg.at + tick);
        } else {
          ctx.moveTo(seg.at, seg.from);
          ctx.lineTo(seg.at, seg.to);
          ctx.moveTo(seg.at - tick, seg.from);
          ctx.lineTo(seg.at + tick, seg.from);
          ctx.moveTo(seg.at - tick, seg.to);
          ctx.lineTo(seg.at + tick, seg.to);
        }
      }
      ctx.stroke();

      // Distance pill on each gap
      const label = `${Math.round(guide.length)}`;
      ctx.font = `${11 * px}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(label).width + 8 * px;
      const h = 14 * px;
      for (const seg of guide.segments) {
        const mid = (seg.from + seg.to) / 2;
        const cx = guide.axis === 'x' ? mid : seg.at;
        const cy = guide.axis === 'x' ? seg.at : mid;
        ctx.fillStyle = CanvasRenderer.SMART_GUIDE_COLOR;
        ctx.beginPath();
        ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 3 * px);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, cx, cy + 0.5 * px);
      }
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Rough.js helpers
  // ---------------------------------------------------------------------------

  /**
   * Build rough.js options from an element's style properties.
   */
  private buildRoughOptions(element: MavisElement): Record<string, unknown> {
    const options: Record<string, unknown> = {
      stroke: element.strokeColor,
      strokeWidth: element.strokeWidth,
      roughness: element.roughness,
      seed: element.seed,
    };

    // Fill
    if (element.backgroundColor !== 'transparent' && element.fillStyle !== 'none') {
      options.fill = element.backgroundColor;
      options.fillStyle = element.fillStyle; // 'hachure', 'solid', 'cross-hatch'
    }

    // Stroke dash
    if (element.strokeStyle === 'dashed') {
      options.strokeLineDash = [8, 4];
    } else if (element.strokeStyle === 'dotted') {
      options.strokeLineDash = [2, 4];
    }

    return options;
  }

  /**
   * Draw a rough.js drawable on an arbitrary canvas context.
   *
   * Rough.js's `RoughCanvas.draw()` always draws on its own internal context,
   * but we need to draw on whichever context is current (could be the
   * interactive canvas for previews). We use the generator to create the
   * drawable, then render the operation sets manually onto our context.
   */
  private drawRoughShape(
    ctx: CanvasRenderingContext2D,
    createDrawable: () => Drawable,
  ): void {
    let drawable: Drawable;
    const cacheFor = this.cacheElement;
    if (cacheFor) {
      const part = this.cachePart++;
      let parts = this.roughCache.get(cacheFor);
      if (!parts) {
        parts = [];
        this.roughCache.set(cacheFor, parts);
      }
      drawable = parts[part] ?? (parts[part] = createDrawable());
    } else {
      drawable = createDrawable();
    }

    // On the static canvas (or one of its bitmaps), RoughCanvas.draw()
    // gives the best quality
    const roughCanvas = ctx === this.staticCtx ? this.roughCanvas : this.roughByCtx.get(ctx);
    if (roughCanvas) {
      roughCanvas.draw(drawable);
      return;
    }

    // For other contexts (interactive canvas), render the drawable manually
    // by converting it to path info and drawing those paths.
    const pathInfos = this.roughCanvas.generator.toPaths(drawable);
    for (const pathInfo of pathInfos) {
      ctx.save();
      const path = new Path2D(pathInfo.d);
      if (pathInfo.fill) {
        ctx.fillStyle = pathInfo.fill;
        ctx.fill(path);
      }
      ctx.strokeStyle = pathInfo.stroke;
      ctx.lineWidth = pathInfo.strokeWidth;
      ctx.stroke(path);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // Clean-mode stroke helpers
  // ---------------------------------------------------------------------------

  private applyCleanStroke(
    ctx: CanvasRenderingContext2D,
    strokeColor: string,
    strokeWidth: number,
    strokeStyle: string,
  ): void {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (strokeStyle === 'dashed') {
      ctx.setLineDash([8, 4]);
    } else if (strokeStyle === 'dotted') {
      ctx.setLineDash([2, 4]);
    } else {
      ctx.setLineDash([]);
    }
  }

  // ---------------------------------------------------------------------------
  // Selection / interaction overlays
  // ---------------------------------------------------------------------------

  /**
   * Draw a dashed blue rectangle around the given bounds to indicate selection.
   */
  renderSelectionBox(ctx: CanvasRenderingContext2D, bounds: Bounds): void {
    const padding = SELECTION_PADDING_PX / this.viewport.getViewport().zoom;
    ctx.save();
    ctx.strokeStyle = CanvasRenderer.SELECTION_COLOR;
    ctx.lineWidth = 1 / this.viewport.getViewport().zoom; // 1px on screen
    ctx.setLineDash([6 / this.viewport.getViewport().zoom, 4 / this.viewport.getViewport().zoom]);
    ctx.strokeRect(
      bounds.x - padding,
      bounds.y - padding,
      bounds.width + padding * 2,
      bounds.height + padding * 2,
    );
    ctx.restore();
  }

  /**
   * Draw 8 resize handles (corners + edge midpoints) around the selection bounds.
   */
  renderResizeHandles(ctx: CanvasRenderingContext2D, bounds: Bounds): void {
    const zoom = this.viewport.getViewport().zoom;
    const padding = SELECTION_PADDING_PX / zoom;
    const handleSize = CanvasRenderer.HANDLE_SIZE / zoom;
    const half = handleSize / 2;

    const x = bounds.x - padding;
    const y = bounds.y - padding;
    const w = bounds.width + padding * 2;
    const h = bounds.height + padding * 2;

    // 8 handle positions: 4 corners + 4 midpoints
    const handles: [number, number][] = [
      [x, y],                      // top-left
      [x + w / 2, y],              // top-center
      [x + w, y],                  // top-right
      [x + w, y + h / 2],          // middle-right
      [x + w, y + h],              // bottom-right
      [x + w / 2, y + h],          // bottom-center
      [x, y + h],                  // bottom-left
      [x, y + h / 2],              // middle-left
    ];

    ctx.save();
    ctx.fillStyle = CanvasRenderer.HANDLE_FILL;
    ctx.strokeStyle = CanvasRenderer.SELECTION_COLOR;
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([]);

    for (const [hx, hy] of handles) {
      ctx.fillRect(hx - half, hy - half, handleSize, handleSize);
      ctx.strokeRect(hx - half, hy - half, handleSize, handleSize);
    }

    ctx.restore();
  }

  /**
   * Rotation handle: a small circle above the frame's top edge, joined to it
   * by a short stem (Excalidraw, Figma). Hit-tested by `hitTestTransformHandle`.
   */
  renderRotationHandle(ctx: CanvasRenderingContext2D, bounds: Bounds): void {
    const zoom = this.viewport.getViewport().zoom;
    const centre = rotationHandleCenter({ bounds, angle: 0 }, zoom);
    const radius = ROTATION_HANDLE_RADIUS_PX / zoom;
    const top = bounds.y - SELECTION_PADDING_PX / zoom;

    ctx.save();
    ctx.strokeStyle = CanvasRenderer.SELECTION_COLOR;
    ctx.fillStyle = CanvasRenderer.HANDLE_FILL;
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(centre.x, top);
    ctx.lineTo(centre.x, centre.y + radius);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Small padlock at the selection's top-right corner for locked elements. */
  private renderLockBadge(ctx: CanvasRenderingContext2D, bounds: Bounds): void {
    const zoom = this.viewport.getViewport().zoom;
    const pad = SELECTION_PADDING_PX / zoom;
    const size = 16 / zoom;
    const x = bounds.x + bounds.width + pad - size / 2;
    const y = bounds.y - pad - size / 2;

    ctx.save();
    ctx.fillStyle = CanvasRenderer.SELECTION_COLOR;
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 3 / zoom);
    ctx.fill();

    // Shackle + body
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 1.5 / zoom;
    const cx = x + size / 2;
    ctx.beginPath();
    ctx.arc(cx, y + size * 0.42, size * 0.18, Math.PI, 0);
    ctx.stroke();
    ctx.fillRect(x + size * 0.27, y + size * 0.45, size * 0.46, size * 0.33);
    ctx.restore();
  }

  /**
   * Draw a subtle highlight border around a hovered element.
   */
  renderHoverHighlight(
    ctx: CanvasRenderingContext2D,
    element: MavisElement,
  ): void {
    const zoom = this.viewport.getViewport().zoom;
    const padding = 4;

    const bounds = this.getElementsBounds([element]);

    ctx.save();
    if (element.angle && !('points' in element)) {
      // Outline a rotated shape along its own edges
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(element.angle);
      ctx.translate(-cx, -cy);
    }
    ctx.strokeStyle = CanvasRenderer.HOVER_COLOR;
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.5;
    ctx.strokeRect(
      bounds.x - padding,
      bounds.y - padding,
      bounds.width + padding * 2,
      bounds.height + padding * 2,
    );
    ctx.restore();
  }

  /**
   * Draw a colored border around an element being edited by a remote user (soft lock).
   * Shows the user's name above the element.
   */
  renderRemoteSelectionBorder(
    ctx: CanvasRenderingContext2D,
    element: MavisElement,
    color: string,
    userName: string,
  ): void {
    const zoom = this.viewport.getViewport().zoom;
    const padding = 4;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.7;
    ctx.strokeRect(
      element.x - padding,
      element.y - padding,
      element.width + padding * 2,
      element.height + padding * 2,
    );

    // Draw user name label above the element
    const fontSize = 10 / zoom;
    ctx.font = `${fontSize}px "Segoe UI", system-ui, sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';

    const labelText = userName;
    const metrics = ctx.measureText(labelText);
    const labelPadX = 4 / zoom;
    const labelPadY = 2 / zoom;
    const labelX = element.x - padding;
    const labelY = element.y - padding - labelPadY;

    // Background pill for the label
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.beginPath();
    const pillH = fontSize + labelPadY * 2;
    const pillW = metrics.width + labelPadX * 2;
    const pillR = 3 / zoom;
    ctx.roundRect(labelX, labelY - pillH, pillW, pillH, pillR);
    ctx.fill();

    // Label text
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(labelText, labelX + labelPadX, labelY - labelPadY);

    ctx.restore();
  }

  /**
   * Draw the selection marquee (rubber-band) rectangle.
   */
  private renderMarquee(
    ctx: CanvasRenderingContext2D,
    box: { x: number; y: number; width: number; height: number },
  ): void {
    const zoom = this.viewport.getViewport().zoom;

    ctx.save();
    // Semi-transparent fill
    ctx.fillStyle = 'rgba(74, 144, 217, 0.08)';
    ctx.fillRect(box.x, box.y, box.width, box.height);

    // Dashed border
    ctx.strokeStyle = CanvasRenderer.SELECTION_COLOR;
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    ctx.restore();
  }

  /**
   * Render anchor points on a shape for edge-initiated connections.
   */
  private renderAnchorPoints(
    ctx: CanvasRenderingContext2D,
    element: MavisElement,
    hoveredAnchor: string | null,
  ): void {
    const zoom = this.viewport.getViewport().zoom;
    // Same dots the hit-test uses (turned with rotated shapes, just outside the outline)
    const anchors = getAnchorDots(element, ANCHOR_DOT_OFFSET_PX / zoom);

    for (const anchor of anchors) {
      const isHovered = hoveredAnchor === anchor.position;
      const radius = (isHovered ? 7 : 5) / zoom;

      ctx.save();
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isHovered ? '#2563eb' : '#4a90d9';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Render snap feedback when arrow endpoint is near a target shape's anchor.
   */
  private renderSnapFeedback(
    ctx: CanvasRenderingContext2D,
    element: MavisElement,
    _anchor: string,
  ): void {
    const zoom = this.viewport.getViewport().zoom;
    const padding = 4;

    ctx.save();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.globalAlpha = 0.6;
    ctx.strokeRect(
      element.x - padding,
      element.y - padding,
      element.width + padding * 2,
      element.height + padding * 2,
    );
    ctx.restore();
  }

  /**
   * Render endpoint handles for a selected linear element (green circles at start/end).
   */
  private renderLinearEndpointHandles(
    ctx: CanvasRenderingContext2D,
    element: LinearElement,
  ): void {
    if (!element.points || element.points.length < 2) return;

    const zoom = this.viewport.getViewport().zoom;
    const radius = 6 / zoom;

    const endpoints = [
      element.points[0],
      element.points[element.points.length - 1],
    ];

    ctx.save();
    for (const [lx, ly] of endpoints) {
      const px = element.x + lx;
      const py = element.y + ly;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#10b981';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Render waypoint handles (diamond shapes at intermediate points).
   */
  private renderWaypointHandles(
    ctx: CanvasRenderingContext2D,
    element: LinearElement,
  ): void {
    if (!element.points || element.points.length <= 2) return;

    const zoom = this.viewport.getViewport().zoom;
    const size = 5 / zoom;

    ctx.save();
    for (let i = 1; i < element.points.length - 1; i++) {
      const px = element.x + element.points[i][0];
      const py = element.y + element.points[i][1];

      ctx.beginPath();
      ctx.moveTo(px, py - size);
      ctx.lineTo(px + size, py);
      ctx.lineTo(px, py + size);
      ctx.lineTo(px - size, py);
      ctx.closePath();
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Render midpoint add handles (+ icons at segment midpoints).
   */
  private renderMidpointAddHandles(
    ctx: CanvasRenderingContext2D,
    element: LinearElement,
  ): void {
    if (!element.points || element.points.length < 2) return;

    const zoom = this.viewport.getViewport().zoom;
    const radius = 7 / zoom;

    ctx.save();
    for (let i = 0; i < element.points.length - 1; i++) {
      const [x1, y1] = element.points[i];
      const [x2, y2] = element.points[i + 1];
      const mx = element.x + (x1 + x2) / 2;
      const my = element.y + (y1 + y2) / 2;

      ctx.beginPath();
      ctx.arc(mx, my, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(74, 144, 217, 0.2)';
      ctx.fill();
      ctx.strokeStyle = '#4a90d9';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();

      const cross = radius * 0.5;
      ctx.beginPath();
      ctx.moveTo(mx - cross, my);
      ctx.lineTo(mx + cross, my);
      ctx.moveTo(mx, my - cross);
      ctx.lineTo(mx, my + cross);
      ctx.strokeStyle = '#4a90d9';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Render segment drag handles for elbow arrows (grab dots at inner segment midpoints).
   */
  private renderElbowSegmentHandles(
    ctx: CanvasRenderingContext2D,
    element: LinearElement,
  ): void {
    const elbowPoints = this.getElbowPointsForElement(element);
    if (elbowPoints.length < 3) return;

    const zoom = this.viewport.getViewport().zoom;
    const dotRadius = 4 / zoom;

    ctx.save();
    // Skip first and last segments (departure/approach to bindings)
    for (let i = 1; i < elbowPoints.length - 2; i++) {
      const [x1, y1] = elbowPoints[i];
      const [x2, y2] = elbowPoints[i + 1];
      const mx = element.x + (x1 + x2) / 2;
      const my = element.y + (y1 + y2) / 2;

      // Draw grab dot
      ctx.beginPath();
      ctx.arc(mx, my, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(74, 144, 217, 0.3)';
      ctx.fill();
      ctx.strokeStyle = '#4a90d9';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();

      // Draw direction indicator (short line perpendicular to drag direction)
      const indicatorSize = 3 / zoom;
      const isHorizontal = Math.abs(y1 - y2) < 1;
      ctx.beginPath();
      if (isHorizontal) {
        // Can drag up/down
        ctx.moveTo(mx, my - indicatorSize);
        ctx.lineTo(mx, my + indicatorSize);
      } else {
        // Can drag left/right
        ctx.moveTo(mx - indicatorSize, my);
        ctx.lineTo(mx + indicatorSize, my);
      }
      ctx.strokeStyle = '#4a90d9';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Compute the axis-aligned bounding box that encloses all given elements.
   * Returns finite bounds; if any element has no valid bounds (e.g. linear with no points), falls back to element box.
   */
  private getElementsBounds(elements: MavisElement[]): Bounds {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const el of elements) {
      if ('points' in el && Array.isArray((el as LinearElement).points)) {
        const linear = el as LinearElement;
        const pts = linear.points;
        if (pts.length > 0) {
          for (const [px, py] of pts) {
            const wx = linear.x + px;
            const wy = linear.y + py;
            if (wx < minX) minX = wx;
            if (wy < minY) minY = wy;
            if (wx > maxX) maxX = wx;
            if (wy > maxY) maxY = wy;
          }
        } else {
          // Linear element with no points: use element box so we always get finite bounds
          if (el.x < minX) minX = el.x;
          if (el.y < minY) minY = el.y;
          if (el.x + el.width > maxX) maxX = el.x + el.width;
          if (el.y + el.height > maxY) maxY = el.y + el.height;
        }
      } else {
        if (el.x < minX) minX = el.x;
        if (el.y < minY) minY = el.y;
        if (el.x + el.width > maxX) maxX = el.x + el.width;
        if (el.y + el.height > maxY) maxY = el.y + el.height;
      }
    }

    let x = minX;
    let y = minY;
    let width = maxX - minX;
    let height = maxY - minY;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
      x = 0;
      y = 0;
      width = 0;
      height = 0;
    }
    return { x, y, width, height };
  }

  /**
   * Get the CSS (logical) pixel size of a canvas, ignoring device-pixel-ratio
   * scaling that was applied in `resize()`.
   */
  private getLogicalSize(canvas: HTMLCanvasElement): {
    width: number;
    height: number;
  } {
    const dpr = window.devicePixelRatio || 1;
    return {
      width: canvas.width / dpr,
      height: canvas.height / dpr,
    };
  }
}

/**
 * Axis-aligned world-space bounds of an element including stroke and
 * arrowheads, used for viewport culling.
 */
export function elementWorldBounds(el: MavisElement): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = el.x;
  let minY = el.y;
  let maxX = el.x + el.width;
  let maxY = el.y + el.height;

  let pad = (el.strokeWidth ?? 0) * 2;
  if (el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw') {
    const linear = el as LinearElement;
    if (linear.points.length > 0) {
      minX = Infinity;
      minY = Infinity;
      maxX = -Infinity;
      maxY = -Infinity;
      for (const [px, py] of linear.points) {
        minX = Math.min(minX, el.x + px);
        minY = Math.min(minY, el.y + py);
        maxX = Math.max(maxX, el.x + px);
        maxY = Math.max(maxY, el.y + py);
      }
    }
    // Arrowheads, curve bulges and elbow detours extend past the points
    pad += linear.routingMode === 'straight' ? 24 : 80;
  }

  if (el.angle) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const r = Math.hypot(maxX - minX, maxY - minY) / 2;
    minX = cx - r;
    maxX = cx + r;
    minY = cy - r;
    maxY = cy + r;
  }

  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** Point halfway along a polyline given relative to (originX, originY). */
function polylineMidpoint(originX: number, originY: number, pts: [number, number][]): Point {
  if (pts.length === 0) return { x: originX, y: originY };
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  let remaining = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (remaining <= seg && seg > 0) {
      const t = remaining / seg;
      return {
        x: originX + pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
        y: originY + pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
      };
    }
    remaining -= seg;
  }
  return { x: originX + pts[0][0], y: originY + pts[0][1] };
}

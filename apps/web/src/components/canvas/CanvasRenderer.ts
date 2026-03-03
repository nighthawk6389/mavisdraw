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
import { getCubicControlPoints } from '@mavisdraw/math';

/**
 * Smart guide line data for rendering alignment guides.
 */
export interface SmartGuide {
  type: 'horizontal' | 'vertical';
  position: number; // x for vertical, y for horizontal
  start: number; // start of the line extent
  end: number; // end of the line extent
}

/**
 * Describes the current interactive/UI state needed for rendering.
 * Passed in each frame so the renderer always draws the latest state.
 */
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
  anchorTarget?: MavisElement | null;
  hoveredAnchor?: string | null;
  rebindingPreview?: { element: LinearElement; endpoint: 'start' | 'end' } | null;
  snapTarget?: { element: MavisElement; anchor: string } | null;
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

  // Image cache to prevent re-decoding
  private imageCache: Map<string, HTMLImageElement> = new Map();

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

  /** Flag the static layer for a full redraw on the next frame. */
  invalidateStatic(): void {
    this.needsStaticRedraw = true;
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

      if (this.needsStaticRedraw) {
        this.renderStaticLayer(elements, state);
        this.needsStaticRedraw = false;
      }

      this.renderInteractiveLayer(elements, state);
      this.animationFrameId = requestAnimationFrame(loop);
    };
    loop();
  }

  /** Stop the render loop and cancel any pending animation frame. */
  stopRenderLoop(): void {
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
  }

  /** Clean up resources and stop the render loop. */
  destroy(): void {
    this.stopRenderLoop();
    this.imageCache.clear();
  }

  // ---------------------------------------------------------------------------
  // Layer rendering
  // ---------------------------------------------------------------------------

  private renderStaticLayer(
    elements: MavisElement[],
    state: RenderState,
  ): void {
    const ctx = this.staticCtx;
    const { width, height } = this.getLogicalSize(this.staticCanvas);
    const vp = this.viewport.getViewport();

    ctx.clearRect(0, 0, width, height);

    // Apply viewport transform
    ctx.save();
    ctx.translate(vp.scrollX, vp.scrollY);
    ctx.scale(vp.zoom, vp.zoom);

    // Draw grid
    this.gridRenderer.render(ctx, vp, width, height, state.gridSize, state.showGrid);

    // Draw each committed element
    for (const element of elements) {
      this.renderElement(ctx, element, state.renderMode);

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
      if (selectedElements.length > 0) {
        // Compute aggregate bounds for the selection
        const bounds = this.getElementsBounds(selectedElements);
        this.renderSelectionBox(ctx, bounds);
        this.renderResizeHandles(ctx, bounds);
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
          this.renderWaypointHandles(ctx, linear);
          this.renderMidpointAddHandles(ctx, linear);
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
  renderElement(
    ctx: CanvasRenderingContext2D,
    element: MavisElement,
    renderMode: RenderMode,
  ): void {
    ctx.save();

    // Transform: translate to element center, rotate, translate back to origin
    ctx.translate(
      element.x + element.width / 2,
      element.y + element.height / 2,
    );
    ctx.rotate(element.angle);
    ctx.translate(-element.width / 2, -element.height / 2);
    ctx.globalAlpha = element.opacity / 100;

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
      case 'line':
      case 'arrow':
      case 'freedraw':
        this.renderLinear(ctx, element as LinearElement, renderMode);
        break;
      case 'text':
        this.renderText(ctx, element as TextElement);
        break;
      case 'portal':
        if (renderMode === 'sketchy') {
          renderPortalSketchy(ctx, this.roughCanvas, element as PortalElement, (c, drawable) => {
            this.drawRoughShape(c, () => drawable);
          });
        } else {
          renderPortalClean(ctx, element as PortalElement);
        }
        break;
      case 'image':
        this.renderImage(ctx, element as ImageElement);
        break;
      default:
        this.renderRectangle(ctx, element as unknown as RectangleElement, renderMode);
        break;
    }

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

    const start = points[0];
    const end = points[points.length - 1];

    // Calculate elbow routing intermediate points
    const elbowPoints = this.calculateElbowPoints(start, end);

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
   * Calculate elbow routing points (right-angle path) between start and end.
   * Uses L-shape or Z-shape depending on relative positions.
   */
  private calculateElbowPoints(
    start: [number, number],
    end: [number, number],
  ): [number, number][] {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const ALIGN_THRESHOLD = 5;

    if (Math.abs(dx) < ALIGN_THRESHOLD) {
      return [start, end];
    }

    if (Math.abs(dy) < ALIGN_THRESHOLD) {
      return [start, end];
    }

    if (Math.abs(dx) > Math.abs(dy)) {
      const midX = start[0] + dx / 2;
      return [
        start,
        [midX, start[1]],
        [midX, end[1]],
        end,
      ];
    } else {
      const midY = start[1] + dy / 2;
      return [
        start,
        [start[0], midY],
        [end[0], midY],
        end,
      ];
    }
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
      const elbowPoints = this.calculateElbowPoints(points[0], points[points.length - 1]);

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

    // Map font family to CSS
    let fontFace: string;
    switch (fontFamily) {
      case 'hand-drawn':
        fontFace = '"Virgil", "Segoe UI Emoji", cursive';
        break;
      case 'sans-serif':
        fontFace = '"Helvetica Neue", Helvetica, Arial, sans-serif';
        break;
      case 'monospace':
        fontFace = '"Cascadia Code", "Fira Code", monospace';
        break;
      default:
        fontFace = 'sans-serif';
    }

    ctx.font = `${fontSize}px ${fontFace}`;
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
   * Word-wrap text to fit within maxWidth.
   */
  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
  ): string[] {
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
      };
    }

    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, 0, 0, width, height);
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

  private renderSmartGuides(
    ctx: CanvasRenderingContext2D,
    guides: SmartGuide[],
  ): void {
    const zoom = this.viewport.getViewport().zoom;

    ctx.save();
    ctx.strokeStyle = CanvasRenderer.SMART_GUIDE_COLOR;
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.globalAlpha = 0.8;

    for (const guide of guides) {
      ctx.beginPath();
      if (guide.type === 'vertical') {
        ctx.moveTo(guide.position, guide.start);
        ctx.lineTo(guide.position, guide.end);
      } else {
        ctx.moveTo(guide.start, guide.position);
        ctx.lineTo(guide.end, guide.position);
      }
      ctx.stroke();
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
    createDrawable: () => import('roughjs/bin/core').Drawable,
  ): void {
    const drawable = createDrawable();

    // If we're drawing on the static canvas context, we can use the
    // RoughCanvas.draw() method directly for best quality.
    if (ctx === this.staticCtx) {
      this.roughCanvas.draw(drawable);
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
    const padding = 4;
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
    const padding = 4;
    const zoom = this.viewport.getViewport().zoom;
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
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;

    const anchors = [
      { position: 'top', x: cx, y: element.y },
      { position: 'right', x: element.x + element.width, y: cy },
      { position: 'bottom', x: cx, y: element.y + element.height },
      { position: 'left', x: element.x, y: cy },
    ];

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
    const size = 8 / zoom; // larger for easier clicking (hit test uses ~14 screen px)

    ctx.save();
    for (let i = 0; i < element.points.length - 1; i++) {
      const [x1, y1] = element.points[i];
      const [x2, y2] = element.points[i + 1];
      const mx = element.x + (x1 + x2) / 2;
      const my = element.y + (y1 + y2) / 2;

      ctx.beginPath();
      ctx.arc(mx, my, size + 2 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(74, 144, 217, 0.15)';
      ctx.fill();
      ctx.strokeStyle = '#4a90d9';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(mx - size * 0.6, my);
      ctx.lineTo(mx + size * 0.6, my);
      ctx.moveTo(mx, my - size * 0.6);
      ctx.lineTo(mx, my + size * 0.6);
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

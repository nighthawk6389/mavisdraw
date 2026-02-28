import rough from 'roughjs';
import type { RoughCanvas } from 'roughjs/bin/canvas';
import type {
  MavisElement,
  RenderMode,
  Viewport,
  Bounds,
  RectangleElement,
  EllipseElement,
  DiamondElement,
  LinearElement,
  TextElement,
} from '@mavisdraw/types';
import { ViewportManager } from './ViewportManager';
import { GridRenderer } from './GridRenderer';

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

  // Selection / handle visual constants
  private static readonly SELECTION_COLOR = '#4a90d9';
  private static readonly HOVER_COLOR = '#4a90d9';
  private static readonly HANDLE_SIZE = 8;
  private static readonly HANDLE_FILL = '#ffffff';

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
        // Portal is rendered as a rectangle with distinct styling (Stage 3)
        this.renderRectangle(ctx, element as unknown as RectangleElement, renderMode);
        break;
      case 'image':
        // Image rendering is a placeholder rectangle (Stage 3)
        this.renderRectangle(ctx, element as unknown as RectangleElement, renderMode);
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
    const { width, height, strokeColor, backgroundColor, fillStyle, strokeWidth, roughness, strokeStyle } = element;
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
    const { points, strokeColor, strokeWidth, strokeStyle, type } = element;

    if (!points || points.length < 2) return;

    if (renderMode === 'sketchy') {
      this.drawRoughShape(ctx, () => {
        const options = this.buildRoughOptions(element);
        // Don't fill linear elements
        delete options.fill;
        delete options.fillStyle;

        if (type === 'freedraw' && points.length > 2) {
          // Use curve for freedraw to smooth it out
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

      if (type === 'freedraw' && points.length > 2) {
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

    // Draw arrowheads for arrow elements
    if (type === 'arrow') {
      this.renderArrowheads(ctx, element, renderMode);
    }
  }

  private renderArrowheads(
    ctx: CanvasRenderingContext2D,
    element: LinearElement,
    _renderMode: RenderMode,
  ): void {
    const { points, strokeColor, strokeWidth, startArrowhead, endArrowhead } = element;
    if (!points || points.length < 2) return;

    const arrowLength = Math.max(10, strokeWidth * 4);
    const arrowAngle = Math.PI / 6; // 30 degrees

    ctx.fillStyle = strokeColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.setLineDash([]);

    // End arrowhead
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

    const lines = text.split('\n');
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

    ctx.save();
    ctx.strokeStyle = CanvasRenderer.HOVER_COLOR;
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.5;
    ctx.strokeRect(
      element.x - padding,
      element.y - padding,
      element.width + padding * 2,
      element.height + padding * 2,
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

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Compute the axis-aligned bounding box that encloses all given elements.
   */
  private getElementsBounds(elements: MavisElement[]): Bounds {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const el of elements) {
      if (el.x < minX) minX = el.x;
      if (el.y < minY) minY = el.y;
      if (el.x + el.width > maxX) maxX = el.x + el.width;
      if (el.y + el.height > maxY) maxY = el.y + el.height;
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
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

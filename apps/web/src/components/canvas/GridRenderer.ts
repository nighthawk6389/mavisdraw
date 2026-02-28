import type { Viewport } from '@mavisdraw/types';

/**
 * Renders a dot-grid background onto a canvas.
 *
 * The grid is drawn in canvas (world) coordinates, but we compute the
 * visible region from the viewport so we only draw dots that are actually
 * on screen.  Dot size and spacing adapt to the current zoom level so
 * the grid remains readable at all zoom levels.
 */
export class GridRenderer {
  /**
   * Draw dots at every grid intersection that falls within the visible area.
   *
   * @param ctx          - The 2D rendering context (already has the viewport
   *                       transform applied via translate + scale).
   * @param viewport     - Current viewport state (scroll + zoom).
   * @param canvasWidth  - Physical width of the canvas element in pixels.
   * @param canvasHeight - Physical height of the canvas element in pixels.
   * @param gridSize     - Spacing between grid lines in canvas units.
   * @param showGrid     - Whether the grid should be drawn at all.
   */
  render(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    canvasWidth: number,
    canvasHeight: number,
    gridSize: number,
    showGrid: boolean,
  ): void {
    if (!showGrid) return;

    const { scrollX, scrollY, zoom } = viewport;

    // Determine the effective grid spacing.
    // When the user zooms out far enough that dots would overlap or become
    // too dense, we double the spacing until the on-screen gap is comfortable.
    let effectiveGridSize = gridSize;
    const minScreenGap = 10; // minimum pixels between dots on screen
    while (effectiveGridSize * zoom < minScreenGap) {
      effectiveGridSize *= 2;
    }

    // Determine the visible range in canvas (world) coordinates.
    const startX = (0 - scrollX) / zoom;
    const startY = (0 - scrollY) / zoom;
    const endX = (canvasWidth - scrollX) / zoom;
    const endY = (canvasHeight - scrollY) / zoom;

    // Snap to grid boundaries (one step beyond the edges to be safe).
    const gridStartX =
      Math.floor(startX / effectiveGridSize) * effectiveGridSize;
    const gridStartY =
      Math.floor(startY / effectiveGridSize) * effectiveGridSize;
    const gridEndX =
      Math.ceil(endX / effectiveGridSize) * effectiveGridSize;
    const gridEndY =
      Math.ceil(endY / effectiveGridSize) * effectiveGridSize;

    // Dot visual properties -- adapt radius to zoom so dots don't vanish
    // or become obnoxiously large.
    const baseRadius = 1;
    const radius = Math.max(0.5, Math.min(2, baseRadius / zoom));

    ctx.fillStyle = '#e0e0e0';

    // We draw directly in canvas-space (the viewport transform is already
    // applied on the context before this method is called).
    for (let x = gridStartX; x <= gridEndX; x += effectiveGridSize) {
      for (let y = gridStartY; y <= gridEndY; y += effectiveGridSize) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

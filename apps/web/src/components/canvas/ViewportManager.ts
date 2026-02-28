import type { Point, Viewport, Bounds } from '@mavisdraw/types';

/**
 * Pure (non-React) class that manages the viewport transform state.
 *
 * The viewport maps between two coordinate spaces:
 *   - **Screen coordinates**: pixel positions on the physical display (0,0 is top-left of the canvas DOM element).
 *   - **Canvas coordinates**: the infinite virtual drawing surface.
 *
 * The transform is defined by scrollX, scrollY, and zoom:
 *   screenX = canvasX * zoom + scrollX
 *   screenY = canvasY * zoom + scrollY
 */
export class ViewportManager {
  private scrollX = 0;
  private scrollY = 0;
  private zoom = 1;

  private readonly MIN_ZOOM = 0.1;
  private readonly MAX_ZOOM = 10;

  /**
   * Return a snapshot of the current viewport state.
   */
  getViewport(): Viewport {
    return {
      scrollX: this.scrollX,
      scrollY: this.scrollY,
      zoom: this.zoom,
    };
  }

  /**
   * Replace the entire viewport state.
   */
  setViewport(v: Viewport): void {
    this.scrollX = v.scrollX;
    this.scrollY = v.scrollY;
    this.zoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, v.zoom));
  }

  /**
   * Convert screen pixel coordinates to canvas (world) coordinates.
   *
   * canvasX = (screenX - scrollX) / zoom
   * canvasY = (screenY - scrollY) / zoom
   */
  screenToCanvas(screenX: number, screenY: number): Point {
    return {
      x: (screenX - this.scrollX) / this.zoom,
      y: (screenY - this.scrollY) / this.zoom,
    };
  }

  /**
   * Convert canvas (world) coordinates to screen pixel coordinates.
   *
   * screenX = canvasX * zoom + scrollX
   * screenY = canvasY * zoom + scrollY
   */
  canvasToScreen(canvasX: number, canvasY: number): Point {
    return {
      x: canvasX * this.zoom + this.scrollX,
      y: canvasY * this.zoom + this.scrollY,
    };
  }

  /**
   * Pan the viewport by the given pixel deltas.
   * Positive deltaX moves the canvas content to the right,
   * positive deltaY moves it down.
   */
  pan(deltaX: number, deltaY: number): void {
    this.scrollX += deltaX;
    this.scrollY += deltaY;
  }

  /**
   * Zoom the viewport centered on a screen-space point.
   *
   * The key insight: the canvas point under the cursor should remain
   * at the same screen position after the zoom.
   *
   * 1. Determine which canvas point is currently under (screenX, screenY).
   * 2. Apply the new zoom factor.
   * 3. Compute where that same canvas point would now appear on screen.
   * 4. Adjust scroll so it appears at the original screen position.
   */
  zoomAt(screenX: number, screenY: number, factor: number): void {
    // 1. Canvas point under cursor before zoom
    const canvasPoint = this.screenToCanvas(screenX, screenY);

    // 2. Apply zoom (clamped)
    const newZoom = Math.max(
      this.MIN_ZOOM,
      Math.min(this.MAX_ZOOM, this.zoom * factor),
    );
    this.zoom = newZoom;

    // 3. Where that canvas point would now map on screen
    //    newScreenX = canvasPoint.x * newZoom + scrollX
    //    We want newScreenX === screenX, so:
    //    scrollX = screenX - canvasPoint.x * newZoom
    this.scrollX = screenX - canvasPoint.x * this.zoom;
    this.scrollY = screenY - canvasPoint.y * this.zoom;
  }

  /**
   * Adjust the viewport so that the given bounds are fully visible
   * and centered, with optional padding (in screen pixels).
   */
  zoomToFit(
    bounds: Bounds,
    viewportWidth: number,
    viewportHeight: number,
    padding = 40,
  ): void {
    if (bounds.width === 0 && bounds.height === 0) {
      this.reset();
      return;
    }

    const availableWidth = viewportWidth - padding * 2;
    const availableHeight = viewportHeight - padding * 2;

    if (availableWidth <= 0 || availableHeight <= 0) {
      this.reset();
      return;
    }

    // Compute the zoom that fits the bounds into the available area
    const zoomX = availableWidth / bounds.width;
    const zoomY = availableHeight / bounds.height;
    const newZoom = Math.max(
      this.MIN_ZOOM,
      Math.min(this.MAX_ZOOM, Math.min(zoomX, zoomY)),
    );

    // Center the bounds in the viewport
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    this.zoom = newZoom;
    this.scrollX = viewportWidth / 2 - centerX * newZoom;
    this.scrollY = viewportHeight / 2 - centerY * newZoom;
  }

  /**
   * Reset the viewport to the default view (origin at top-left, 100% zoom).
   */
  reset(): void {
    this.scrollX = 0;
    this.scrollY = 0;
    this.zoom = 1;
  }
}

import type { Point, Viewport } from '@mavisdraw/types';

/**
 * Imperative handle to the mounted canvas, for UI outside the canvas
 * (keyboard shortcuts, menus, zoom controls) that needs to drive the
 * viewport or know where the pointer is without re-rendering on every move.
 */
export interface CanvasController {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  zoomToFit: () => void;
  zoomToSelection: () => void;
  /** Pointer position in canvas coordinates, or the viewport center if unknown. */
  getPasteAnchor: () => Point;
  /** Request a repaint of the canvas. */
  invalidate: () => void;
  /** Drill into the nested diagram behind a portal element. */
  openPortal?: (portalId: string) => void;
  /** Start editing the label of a shape/connector (or a text element itself). */
  editLabel?: (elementId: string) => void;
  /** Pan so a canvas point is in the middle of the screen (zoom unchanged). */
  centerOn?: (point: Point) => void;
  getViewport?: () => Viewport;
  /** Animate the camera to a viewport (null: frame the diagram's content). */
  flyTo?: (target: Viewport | null, durationMs?: number) => Promise<void>;
}

let current: CanvasController | null = null;

export function registerCanvasController(controller: CanvasController | null): void {
  current = controller;
}

export function getCanvasController(): CanvasController | null {
  return current;
}

import type { Bounds } from '@mavisdraw/types';

/**
 * Where the minimap puts the world: the diagram's content and the visible
 * area together, fitted into the minimap with a margin and centred.
 */
export interface MinimapLayout {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const MARGIN = 0.08;

export function minimapLayout(
  content: Bounds | null,
  view: Bounds,
  size: { width: number; height: number },
): MinimapLayout {
  const minX = Math.min(view.x, content?.x ?? view.x);
  const minY = Math.min(view.y, content?.y ?? view.y);
  const maxX = Math.max(view.x + view.width, content ? content.x + content.width : -Infinity);
  const maxY = Math.max(view.y + view.height, content ? content.y + content.height : -Infinity);
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const scale = Math.min((size.width * (1 - 2 * MARGIN)) / w, (size.height * (1 - 2 * MARGIN)) / h);
  return {
    scale,
    offsetX: (size.width - w * scale) / 2 - minX * scale,
    offsetY: (size.height - h * scale) / 2 - minY * scale,
  };
}

/** A point on the minimap → the canvas point it shows. */
export function minimapToCanvas(layout: MinimapLayout, x: number, y: number) {
  return { x: (x - layout.offsetX) / layout.scale, y: (y - layout.offsetY) / layout.scale };
}

/** The part of the canvas on screen, from the viewport and the canvas's size on screen. */
export function visibleBounds(
  viewport: { zoom: number; scrollX: number; scrollY: number },
  screen: { width: number; height: number },
): Bounds {
  return {
    x: -viewport.scrollX / viewport.zoom,
    y: -viewport.scrollY / viewport.zoom,
    width: screen.width / viewport.zoom,
    height: screen.height / viewport.zoom,
  };
}

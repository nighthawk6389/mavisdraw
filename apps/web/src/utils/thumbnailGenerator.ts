import type { MavisElement, RenderMode, Bounds } from '@mavisdraw/types';

/** Default thumbnail canvas dimensions. */
const THUMBNAIL_WIDTH = 200;
const THUMBNAIL_HEIGHT = 150;
const THUMBNAIL_PADDING = 10;

/**
 * Compute the axis-aligned bounding box enclosing all elements.
 */
function computeElementsBounds(elements: MavisElement[]): Bounds | null {
  if (elements.length === 0) return null;

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

export interface ThumbnailRenderCallback {
  (
    ctx: CanvasRenderingContext2D,
    element: MavisElement,
    renderMode: RenderMode,
  ): void;
}

/**
 * Generate a thumbnail data URL by rendering elements onto an offscreen canvas.
 *
 * @param elements    - The visible (non-deleted) elements for the diagram.
 * @param renderMode  - The render mode to use ('sketchy' or 'clean').
 * @param renderElement - Callback to render a single element onto the canvas.
 * @returns A data URL string representing the thumbnail image, or null if no elements.
 */
export function generateThumbnail(
  elements: MavisElement[],
  renderMode: RenderMode,
  renderElement: ThumbnailRenderCallback,
): string | null {
  if (elements.length === 0) return null;

  const bounds = computeElementsBounds(elements);
  if (!bounds || bounds.width === 0 || bounds.height === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = THUMBNAIL_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Compute scale to fit all elements in the thumbnail area
  const availableW = THUMBNAIL_WIDTH - THUMBNAIL_PADDING * 2;
  const availableH = THUMBNAIL_HEIGHT - THUMBNAIL_PADDING * 2;
  const scaleX = availableW / bounds.width;
  const scaleY = availableH / bounds.height;
  const scale = Math.min(scaleX, scaleY, 2); // Cap at 2x to avoid oversized rendering

  // Center the content
  const scaledW = bounds.width * scale;
  const scaledH = bounds.height * scale;
  const offsetX = (THUMBNAIL_WIDTH - scaledW) / 2;
  const offsetY = (THUMBNAIL_HEIGHT - scaledH) / 2;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);

  // Apply transform
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.translate(-bounds.x, -bounds.y);

  // Render each element
  for (const element of elements) {
    ctx.save();
    ctx.translate(element.x + element.width / 2, element.y + element.height / 2);
    ctx.rotate(element.angle);
    ctx.translate(-element.width / 2, -element.height / 2);
    ctx.globalAlpha = element.opacity / 100;

    renderElement(ctx, element, renderMode);

    ctx.restore();
  }

  ctx.restore();

  return canvas.toDataURL('image/png', 0.7);
}

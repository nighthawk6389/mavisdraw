import type { RoughCanvas } from 'roughjs/bin/canvas';
import type { Drawable } from 'roughjs/bin/core';
import type { PortalElement } from '@mavisdraw/types';

export type RoughDrawFn = (ctx: CanvasRenderingContext2D, drawable: Drawable) => void;

/** Corner radius for portal card style. */
const CARD_RADIUS = 12;
/** Corner radius for badge style. */
const BADGE_RADIUS = 16;
/** Title bar height for card style. */
const TITLE_BAR_HEIGHT = 32;
/** Icon size for the drill-down arrow. */
const ICON_SIZE = 14;
/** Padding inside the portal card. */
const PADDING = 8;

// ─── Cached thumbnail images ──────────────────────────────────────
const thumbnailImageCache = new Map<string, HTMLImageElement>();

function getCachedThumbnailImage(dataUrl: string): HTMLImageElement | null {
  const cached = thumbnailImageCache.get(dataUrl);
  if (cached && cached.complete) return cached;
  if (!cached) {
    const img = new Image();
    img.src = dataUrl;
    thumbnailImageCache.set(dataUrl, img);
  }
  return null;
}

// ─── Drawing helpers ──────────────────────────────────────────────

function drawDrillDownIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  // Draw arrow icon (top-right pointing arrow)
  const halfSize = size / 2;
  const startX = x - halfSize;
  const startY = y + halfSize;
  const endX = x + halfSize;
  const endY = y - halfSize;

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  // Arrowhead
  const arrowLen = size * 0.4;
  ctx.beginPath();
  ctx.moveTo(endX - arrowLen, endY);
  ctx.lineTo(endX, endY);
  ctx.lineTo(endX, endY + arrowLen);
  ctx.stroke();

  ctx.restore();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  color: string,
  bold = false,
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px "Segoe UI", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // Truncate text if too wide
  let displayText = text;
  const measured = ctx.measureText(displayText);
  if (measured.width > maxWidth) {
    while (displayText.length > 1 && ctx.measureText(displayText + '...').width > maxWidth) {
      displayText = displayText.slice(0, -1);
    }
    displayText += '...';
  }

  ctx.fillText(displayText, x, y);
  ctx.restore();
}

function drawElementCountIndicator(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = '11px "Segoe UI", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.5;
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

// ─── Card style ───────────────────────────────────────────────────

function renderCardClean(
  ctx: CanvasRenderingContext2D,
  element: PortalElement,
): void {
  const { width, height, strokeColor, backgroundColor, strokeWidth, label, thumbnailDataUrl } =
    element;

  const bgColor = backgroundColor === 'transparent' ? '#f8f9fb' : backgroundColor;

  // Main rounded rectangle
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, CARD_RADIUS);
  ctx.fillStyle = bgColor;
  ctx.fill();
  if (strokeWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.setLineDash([]);
    ctx.stroke();
  }

  // Title bar
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, width, TITLE_BAR_HEIGHT, [CARD_RADIUS, CARD_RADIUS, 0, 0]);
  ctx.fillStyle = adjustAlpha(strokeColor, 0.08);
  ctx.fill();

  // Title bar divider
  ctx.beginPath();
  ctx.moveTo(0, TITLE_BAR_HEIGHT);
  ctx.lineTo(width, TITLE_BAR_HEIGHT);
  ctx.strokeStyle = adjustAlpha(strokeColor, 0.15);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Label
  const labelMaxWidth = width - PADDING * 2 - ICON_SIZE - PADDING;
  drawLabel(
    ctx,
    label || 'Portal',
    PADDING,
    TITLE_BAR_HEIGHT / 2,
    labelMaxWidth,
    13,
    strokeColor,
    true,
  );

  // Drill-down icon
  drawDrillDownIcon(
    ctx,
    width - PADDING - ICON_SIZE / 2,
    TITLE_BAR_HEIGHT / 2,
    ICON_SIZE,
    strokeColor,
  );

  // Thumbnail area
  const thumbX = PADDING;
  const thumbY = TITLE_BAR_HEIGHT + PADDING;
  const thumbW = width - PADDING * 2;
  const thumbH = height - TITLE_BAR_HEIGHT - PADDING * 2;

  if (thumbW > 0 && thumbH > 0) {
    if (thumbnailDataUrl) {
      const img = getCachedThumbnailImage(thumbnailDataUrl);
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(thumbX, thumbY, thumbW, thumbH, 4);
        ctx.clip();
        ctx.drawImage(img, thumbX, thumbY, thumbW, thumbH);
        ctx.restore();
      } else {
        drawElementCountIndicator(ctx, 'Loading...', width / 2, thumbY + thumbH / 2, strokeColor);
      }
    }
  }
}

function renderCardSketchy(
  ctx: CanvasRenderingContext2D,
  roughCanvas: RoughCanvas,
  element: PortalElement,
  drawRough: RoughDrawFn,
): void {
  const { width, height, strokeColor, backgroundColor, strokeWidth, roughness, seed, label, thumbnailDataUrl } =
    element;

  const bgColor = backgroundColor === 'transparent' ? '#f8f9fb' : backgroundColor;

  drawRough(
    ctx,
    roughCanvas.generator.rectangle(0, 0, width, height, {
      stroke: strokeColor,
      strokeWidth,
      roughness,
      seed,
      fill: bgColor,
      fillStyle: 'solid',
    }),
  );

  drawRough(
    ctx,
    roughCanvas.generator.line(0, TITLE_BAR_HEIGHT, width, TITLE_BAR_HEIGHT, {
      stroke: adjustAlpha(strokeColor, 0.3),
      strokeWidth: 1,
      roughness: roughness * 0.5,
      seed,
    }),
  );

  // Label
  const labelMaxWidth = width - PADDING * 2 - ICON_SIZE - PADDING;
  drawLabel(
    ctx,
    label || 'Portal',
    PADDING,
    TITLE_BAR_HEIGHT / 2,
    labelMaxWidth,
    13,
    strokeColor,
    true,
  );

  // Drill-down icon
  drawDrillDownIcon(
    ctx,
    width - PADDING - ICON_SIZE / 2,
    TITLE_BAR_HEIGHT / 2,
    ICON_SIZE,
    strokeColor,
  );

  // Thumbnail area
  const thumbX = PADDING;
  const thumbY = TITLE_BAR_HEIGHT + PADDING;
  const thumbW = width - PADDING * 2;
  const thumbH = height - TITLE_BAR_HEIGHT - PADDING * 2;

  if (thumbW > 0 && thumbH > 0) {
    if (thumbnailDataUrl) {
      const img = getCachedThumbnailImage(thumbnailDataUrl);
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(thumbX, thumbY, thumbW, thumbH);
        ctx.clip();
        ctx.drawImage(img, thumbX, thumbY, thumbW, thumbH);
        ctx.restore();
      } else {
        drawElementCountIndicator(ctx, 'Loading...', width / 2, thumbY + thumbH / 2, strokeColor);
      }
    }
  }
}

// ─── Badge style ──────────────────────────────────────────────────

function renderBadgeClean(
  ctx: CanvasRenderingContext2D,
  element: PortalElement,
): void {
  const { width, height, strokeColor, backgroundColor, strokeWidth, label } = element;

  const bgColor = backgroundColor === 'transparent' ? '#f0f4ff' : backgroundColor;

  // Pill shape
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, BADGE_RADIUS);
  ctx.fillStyle = bgColor;
  ctx.fill();
  if (strokeWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.setLineDash([]);
    ctx.stroke();
  }

  // Label + icon
  const iconSpace = ICON_SIZE + PADDING;
  const labelMaxWidth = width - PADDING * 2 - iconSpace;
  drawLabel(
    ctx,
    label || 'Portal',
    PADDING,
    height / 2,
    labelMaxWidth,
    12,
    strokeColor,
    false,
  );

  // Drill-down icon
  drawDrillDownIcon(
    ctx,
    width - PADDING - ICON_SIZE / 2,
    height / 2,
    ICON_SIZE * 0.8,
    strokeColor,
  );
}

function renderBadgeSketchy(
  ctx: CanvasRenderingContext2D,
  roughCanvas: RoughCanvas,
  element: PortalElement,
  drawRough: RoughDrawFn,
): void {
  const { width, height, strokeColor, backgroundColor, strokeWidth, roughness, seed, label } = element;

  const bgColor = backgroundColor === 'transparent' ? '#f0f4ff' : backgroundColor;

  drawRough(
    ctx,
    roughCanvas.generator.rectangle(0, 0, width, height, {
      stroke: strokeColor,
      strokeWidth,
      roughness,
      seed,
      fill: bgColor,
      fillStyle: 'solid',
    }),
  );

  // Label + icon
  const iconSpace = ICON_SIZE + PADDING;
  const labelMaxWidth = width - PADDING * 2 - iconSpace;
  drawLabel(
    ctx,
    label || 'Portal',
    PADDING,
    height / 2,
    labelMaxWidth,
    12,
    strokeColor,
    false,
  );

  drawDrillDownIcon(
    ctx,
    width - PADDING - ICON_SIZE / 2,
    height / 2,
    ICON_SIZE * 0.8,
    strokeColor,
  );
}

// ─── Expanded style ───────────────────────────────────────────────

function renderExpandedClean(
  ctx: CanvasRenderingContext2D,
  element: PortalElement,
): void {
  const { width, height, strokeColor, backgroundColor, strokeWidth, label, thumbnailDataUrl } =
    element;

  const bgColor = backgroundColor === 'transparent' ? '#f8f9fb' : backgroundColor;
  const headerHeight = 28;

  // Main rounded rectangle
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, CARD_RADIUS);
  ctx.fillStyle = bgColor;
  ctx.fill();
  if (strokeWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.setLineDash([]);
    ctx.stroke();
  }

  // Header label bar
  const labelMaxWidth = width - PADDING * 2 - ICON_SIZE - PADDING;
  drawLabel(
    ctx,
    label || 'Portal',
    PADDING,
    headerHeight / 2,
    labelMaxWidth,
    12,
    strokeColor,
    true,
  );

  // Drill-down icon
  drawDrillDownIcon(
    ctx,
    width - PADDING - ICON_SIZE / 2,
    headerHeight / 2,
    ICON_SIZE,
    strokeColor,
  );

  // Thumbnail preview takes most of the space
  const thumbX = PADDING;
  const thumbY = headerHeight;
  const thumbW = width - PADDING * 2;
  const thumbH = height - headerHeight - PADDING;

  if (thumbW > 0 && thumbH > 0) {
    // Thumbnail border
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(thumbX, thumbY, thumbW, thumbH, 6);
    ctx.strokeStyle = adjustAlpha(strokeColor, 0.12);
    ctx.lineWidth = 1;
    ctx.stroke();

    if (thumbnailDataUrl) {
      const img = getCachedThumbnailImage(thumbnailDataUrl);
      if (img) {
        ctx.beginPath();
        ctx.roundRect(thumbX, thumbY, thumbW, thumbH, 6);
        ctx.clip();
        ctx.drawImage(img, thumbX, thumbY, thumbW, thumbH);
      } else {
        drawElementCountIndicator(
          ctx,
          'Loading...',
          width / 2,
          thumbY + thumbH / 2,
          strokeColor,
        );
      }
    }
    ctx.restore();
  }
}

function renderExpandedSketchy(
  ctx: CanvasRenderingContext2D,
  roughCanvas: RoughCanvas,
  element: PortalElement,
  drawRough: RoughDrawFn,
): void {
  const { width, height, strokeColor, backgroundColor, strokeWidth, roughness, seed, label, thumbnailDataUrl } =
    element;

  const bgColor = backgroundColor === 'transparent' ? '#f8f9fb' : backgroundColor;
  const headerHeight = 28;

  drawRough(
    ctx,
    roughCanvas.generator.rectangle(0, 0, width, height, {
      stroke: strokeColor,
      strokeWidth,
      roughness,
      seed,
      fill: bgColor,
      fillStyle: 'solid',
    }),
  );

  // Label
  const labelMaxWidth = width - PADDING * 2 - ICON_SIZE - PADDING;
  drawLabel(
    ctx,
    label || 'Portal',
    PADDING,
    headerHeight / 2,
    labelMaxWidth,
    12,
    strokeColor,
    true,
  );

  // Drill-down icon
  drawDrillDownIcon(
    ctx,
    width - PADDING - ICON_SIZE / 2,
    headerHeight / 2,
    ICON_SIZE,
    strokeColor,
  );

  // Thumbnail preview
  const thumbX = PADDING;
  const thumbY = headerHeight;
  const thumbW = width - PADDING * 2;
  const thumbH = height - headerHeight - PADDING;

  if (thumbW > 0 && thumbH > 0) {
    if (thumbnailDataUrl) {
      const img = getCachedThumbnailImage(thumbnailDataUrl);
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(thumbX, thumbY, thumbW, thumbH);
        ctx.clip();
        ctx.drawImage(img, thumbX, thumbY, thumbW, thumbH);
        ctx.restore();
      } else {
        drawElementCountIndicator(
          ctx,
          'Loading...',
          width / 2,
          thumbY + thumbH / 2,
          strokeColor,
        );
      }
    }
  }
}

// ─── Color utility ────────────────────────────────────────────────

function adjustAlpha(hexColor: string, alpha: number): string {
  // Convert hex to rgba
  const hex = hexColor.replace('#', '');
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hexColor;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Render a portal element in sketchy (Rough.js) mode.
 * Must be called after the context has been translated to the element origin.
 */
export function renderPortalSketchy(
  ctx: CanvasRenderingContext2D,
  roughCanvas: RoughCanvas,
  element: PortalElement,
  drawRough: RoughDrawFn,
): void {
  switch (element.portalStyle) {
    case 'badge':
      renderBadgeSketchy(ctx, roughCanvas, element, drawRough);
      break;
    case 'expanded':
      renderExpandedSketchy(ctx, roughCanvas, element, drawRough);
      break;
    case 'card':
    default:
      renderCardSketchy(ctx, roughCanvas, element, drawRough);
      break;
  }
}

/**
 * Render a portal element in clean (Path2D) mode.
 * Must be called after the context has been translated to the element origin.
 */
export function renderPortalClean(
  ctx: CanvasRenderingContext2D,
  element: PortalElement,
): void {
  switch (element.portalStyle) {
    case 'badge':
      renderBadgeClean(ctx, element);
      break;
    case 'expanded':
      renderExpandedClean(ctx, element);
      break;
    case 'card':
    default:
      renderCardClean(ctx, element);
      break;
  }
}

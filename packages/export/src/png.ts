import type {
  MavisElement,
  Diagram,
  RenderMode,
  PngExportOptions,
  MavisDrawAppState,
} from '@mavisdraw/types';
import { computeElementsBounds } from './utils/bounds';
import { embedPngTextChunk, extractPngTextChunk } from './utils/png-metadata';
import { exportToMavisDrawFile } from './json';

const MAVISDRAW_PNG_KEYWORD = 'mavisdraw-scene';

/**
 * Callback that renders a single element onto a canvas context.
 * The callback is responsible for applying element-level transforms
 * (translate, rotate, opacity) — matching CanvasRenderer.renderElement().
 */
export type RenderElementCallback = (
  ctx: CanvasRenderingContext2D,
  element: MavisElement,
  renderMode: RenderMode,
) => void;

/**
 * Export elements to a PNG Blob.
 *
 * Creates an offscreen canvas, applies viewport-level transform, then calls
 * renderElement for each element (which handles its own per-element transform).
 *
 * IMPORTANT: Do NOT apply per-element transforms before calling renderElement —
 * renderElement already handles translate/rotate/opacity internally.
 */
export async function exportToPng(
  elements: MavisElement[],
  options: PngExportOptions,
  renderElement: RenderElementCallback,
  backgroundColor?: string,
  diagrams?: Diagram[],
  rootDiagramId?: string,
): Promise<Blob> {
  const liveElements = elements.filter((el) => !el.isDeleted);
  const bounds = computeElementsBounds(liveElements);
  if (!bounds || bounds.width === 0 || bounds.height === 0) {
    // Return a minimal 1x1 transparent PNG
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Failed to create PNG blob'))),
        'image/png',
      );
    });
  }

  const { scale, padding, includeBackground, embedScene, renderMode } = options;

  const canvasWidth = Math.ceil((bounds.width + padding * 2) * scale);
  const canvasHeight = Math.ceil((bounds.height + padding * 2) * scale);

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas 2D context');

  // Background
  if (includeBackground && backgroundColor) {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  // Viewport transform: scale and translate so elements fit with padding
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(padding - bounds.x, padding - bounds.y);

  // Render each element — renderElement handles per-element transform
  for (const element of liveElements) {
    renderElement(ctx, element, renderMode);
  }

  ctx.restore();

  // Convert to Blob
  let blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to create PNG blob'))),
      'image/png',
    );
  });

  // Optionally embed scene JSON in PNG tEXt chunk
  if (embedScene && diagrams && rootDiagramId) {
    const file = exportToMavisDrawFile(diagrams, elements, rootDiagramId);
    const sceneJson = JSON.stringify(file);
    const pngBuffer = await blob.arrayBuffer();
    const embeddedBuffer = embedPngTextChunk(pngBuffer, MAVISDRAW_PNG_KEYWORD, sceneJson);
    blob = new Blob([embeddedBuffer], { type: 'image/png' });
  }

  return blob;
}

/**
 * Check if a PNG file contains embedded MavisDraw scene data.
 */
export function hasMavisDrawScene(pngBuffer: ArrayBuffer): boolean {
  return extractPngTextChunk(pngBuffer, MAVISDRAW_PNG_KEYWORD) !== null;
}

/**
 * Extract MavisDraw scene data from a PNG with embedded metadata.
 */
export function importFromPng(pngBuffer: ArrayBuffer): {
  diagrams: Diagram[];
  elements: MavisElement[];
  rootDiagramId: string;
  appState?: MavisDrawAppState;
} | null {
  const json = extractPngTextChunk(pngBuffer, MAVISDRAW_PNG_KEYWORD);
  if (!json) return null;

  try {
    const file = JSON.parse(json);
    if (file.type !== 'mavisdraw' || !file.scene) return null;
    return {
      diagrams: file.scene.diagrams,
      elements: file.scene.elements,
      rootDiagramId: file.scene.rootDiagramId,
      appState: file.appState,
    };
  } catch {
    return null;
  }
}

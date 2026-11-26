import type { MavisElement, RenderMode, Diagram } from '@mavisdraw/types';
import { exportToPng } from '@mavisdraw/export';
import { CanvasRenderer } from '../components/canvas/CanvasRenderer';
import { sortByStacking } from '../stores/elementsStore';
import { whenFontsReady } from './fonts';

let offscreen: CanvasRenderer | null = null;

/** A renderer bound to detached canvases, used only to draw elements for export. */
function exportRenderer(): CanvasRenderer {
  if (!offscreen) {
    offscreen = new CanvasRenderer(document.createElement('canvas'), document.createElement('canvas'));
  }
  return offscreen;
}

export interface PngOptions {
  renderMode: RenderMode;
  scale?: number;
  padding?: number;
  background?: string | null;
  /** Embed the scene so the PNG can be re-imported as an editable diagram. */
  embedScene?: { diagrams: Diagram[]; rootDiagramId: string } | null;
}

/** Render elements (one diagram) to a PNG blob exactly as they look on the canvas. */
export async function renderElementsToPng(
  elements: MavisElement[],
  options: PngOptions,
): Promise<Blob> {
  await whenFontsReady();
  const renderer = exportRenderer();
  const ordered = sortByStacking(elements.filter((el) => !el.isDeleted));
  renderer.setElementsContext(ordered);
  return exportToPng(
    ordered,
    {
      format: 'png',
      includeBackground: !!options.background,
      scale: options.scale ?? 2,
      includeNestedDiagrams: false,
      renderMode: options.renderMode,
      embedScene: !!options.embedScene,
      padding: options.padding ?? 24,
    },
    (ctx, element, mode) => renderer.renderElement(ctx, element, mode),
    options.background ?? undefined,
    options.embedScene?.diagrams,
    options.embedScene?.rootDiagramId,
  );
}

/** Copy elements to the system clipboard as a PNG (paste into Slack, docs, email). */
export async function copyElementsAsPng(
  elements: MavisElement[],
  renderMode: RenderMode,
): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
  // Safari requires the promise to be passed directly to ClipboardItem
  const blobPromise = renderElementsToPng(elements, { renderMode, background: '#ffffff' });
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
    return true;
  } catch (err) {
    console.error('Copy as PNG failed:', err);
    return false;
  }
}

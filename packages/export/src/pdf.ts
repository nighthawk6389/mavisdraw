import type {
  MavisElement,
  Diagram,
  PdfExportOptions,
  RenderMode,
} from '@mavisdraw/types';
import { PDFDocument } from 'pdf-lib';
import { computeElementsBounds } from './utils/bounds';

type RenderElementCallback = (
  ctx: CanvasRenderingContext2D,
  element: MavisElement,
  renderMode: RenderMode,
) => void;

// Page sizes in points (1 point = 1/72 inch)
const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const;

const DEFAULT_PADDING = 40;

/**
 * Export diagrams to a PDF Blob.
 *
 * Strategy: Render each diagram to an offscreen canvas (PNG), then embed
 * the images into a PDF document using pdf-lib.
 */
export async function exportToPdf(
  diagrams: Diagram[],
  elementsByDiagram: Map<string, MavisElement[]>,
  options: PdfExportOptions,
  renderElement: RenderElementCallback,
): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();

  // Determine which diagrams to include
  const diagramsToExport = options.includeNestedDiagrams
    ? diagrams
    : diagrams.slice(0, 1);

  for (const diagram of diagramsToExport) {
    const elements = (elementsByDiagram.get(diagram.id) ?? []).filter((el) => !el.isDeleted);
    if (elements.length === 0) continue;

    const bounds = computeElementsBounds(elements);
    if (!bounds || bounds.width === 0 || bounds.height === 0) continue;

    // Determine page dimensions
    let pageWidth: number;
    let pageHeight: number;

    if (options.pageSize === 'auto') {
      pageWidth = bounds.width + DEFAULT_PADDING * 2;
      pageHeight = bounds.height + DEFAULT_PADDING * 2;
    } else {
      const size = PAGE_SIZES[options.pageSize];
      pageWidth = size.width;
      pageHeight = size.height;
    }

    // Scale to fit page
    const availableW = pageWidth - DEFAULT_PADDING * 2;
    const availableH = pageHeight - DEFAULT_PADDING * 2;
    const scaleX = availableW / bounds.width;
    const scaleY = availableH / bounds.height;
    const fitScale = Math.min(scaleX, scaleY, options.scale);

    // Create offscreen canvas
    const canvasWidth = Math.ceil(pageWidth * options.scale);
    const canvasHeight = Math.ceil(pageHeight * options.scale);
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    // White background
    if (options.includeBackground) {
      ctx.fillStyle = diagram.viewBackgroundColor || '#ffffff';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }

    // Transform to fit content
    ctx.save();
    ctx.scale(options.scale, options.scale);

    const scaledW = bounds.width * fitScale;
    const scaledH = bounds.height * fitScale;
    const offsetX = (pageWidth - scaledW) / 2;
    const offsetY = (pageHeight - scaledH) / 2;

    ctx.translate(offsetX, offsetY);
    ctx.scale(fitScale, fitScale);
    ctx.translate(-bounds.x, -bounds.y);

    for (const element of elements) {
      renderElement(ctx, element, options.renderMode);
    }
    ctx.restore();

    // Convert canvas to PNG
    const pngDataUrl = canvas.toDataURL('image/png');
    const pngBase64 = pngDataUrl.split(',')[1];
    const pngBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));

    // Add page to PDF
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    const pngImage = await pdfDoc.embedPng(pngBytes);
    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });
  }

  // If no pages were added, add a blank page
  if (pdfDoc.getPageCount() === 0) {
    pdfDoc.addPage();
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

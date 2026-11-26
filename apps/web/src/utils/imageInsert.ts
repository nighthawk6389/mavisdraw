import type { ImageElement, Point } from '@mavisdraw/types';
import { useElementsStore } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';
import { useSelectionStore } from '../stores/selectionStore';
import { getCanvasController } from '../components/canvas/canvasController';

/** Longest edge kept when storing an image (images are stored inline and synced). */
const MAX_STORED_EDGE = 1600;
/** Longest edge of the element when first placed on the canvas. */
const MAX_PLACED_EDGE = 400;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });
}

/** Downscale very large images so they don't bloat saves and sync traffic. */
function downscale(img: HTMLImageElement, dataUrl: string, type: string): string {
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest <= MAX_STORED_EDGE) return dataUrl;
  const scale = MAX_STORED_EDGE / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const outType = type === 'image/jpeg' || type === 'image/webp' ? type : 'image/png';
  return canvas.toDataURL(outType, 0.85);
}

/** Insert an image file/blob centered on `at` (canvas coordinates) and select it. */
export async function insertImageFile(file: Blob, at: Point): Promise<ImageElement | null> {
  try {
    const original = await readAsDataUrl(file);
    const img = await loadImage(original);
    const dataUrl = downscale(img, original, file.type);

    let width = img.naturalWidth;
    let height = img.naturalHeight;
    const longest = Math.max(width, height);
    if (longest > MAX_PLACED_EDGE) {
      const scale = MAX_PLACED_EDGE / longest;
      width *= scale;
      height *= scale;
    }

    const store = useElementsStore.getState();
    const diagramId = useDiagramStore.getState().activeDiagramId;
    const base = store.createElement(
      'image',
      diagramId,
      at.x - width / 2,
      at.y - height / 2,
      width,
      height,
    ) as ImageElement;
    const element: ImageElement = { ...base, imageUrl: dataUrl, aspectRatio: width / height };
    store.addElement(element);
    useSelectionStore.getState().select(element.id);
    getCanvasController()?.invalidate();
    return element;
  } catch (err) {
    console.error('Failed to insert image:', err);
    return null;
  }
}

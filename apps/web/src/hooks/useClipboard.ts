import { useEffect } from 'react';
import type { TextElement } from '@mavisdraw/types';
import {
  copySelection,
  deleteSelection,
  parseClipboardEnvelope,
  pasteInternal,
} from '../editor/actions';
import { useElementsStore } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';
import { useSelectionStore } from '../stores/selectionStore';
import { getCanvasController } from '../components/canvas/canvasController';
import { insertImageFile } from '../utils/imageInsert';
import { measureText } from '../utils/fonts';

/**
 * Text pasted onto the canvas that isn't MavisDraw data. Returns true when
 * handled. Other modules (e.g. diagram-as-code import) can register handlers
 * that run before the default "make a text element" behaviour.
 */
export type TextPasteHandler = (text: string, at: { x: number; y: number }) => boolean;
const textPasteHandlers: TextPasteHandler[] = [];

export function registerTextPasteHandler(handler: TextPasteHandler): () => void {
  textPasteHandlers.push(handler);
  return () => {
    const i = textPasteHandlers.indexOf(handler);
    if (i >= 0) textPasteHandlers.splice(i, 1);
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}

function pasteText(text: string): void {
  const at = getCanvasController()?.getPasteAnchor() ?? { x: 0, y: 0 };
  for (const handler of textPasteHandlers) {
    if (handler(text, at)) return;
  }

  // Default: drop the text on the canvas as a text element
  const store = useElementsStore.getState();
  const diagramId = useDiagramStore.getState().activeDiagramId;
  const base = store.createElement('text', diagramId, at.x, at.y, 200, 30) as TextElement;
  const size = measureText(text, base.fontSize, base.fontFamily, base.lineHeight);
  const el: TextElement = {
    ...base,
    text,
    x: at.x - size.width / 2,
    y: at.y - size.height / 2,
    width: Math.max(20, size.width + 10),
    height: Math.max(base.fontSize * base.lineHeight, size.height),
  };
  store.addElement(el);
  useSelectionStore.getState().select(el.id);
}

// Browsers that don't dispatch clipboard events on non-editable targets
// (Safari) still get keyboard copy/cut/paste through these fallbacks.
let pendingFallback: ReturnType<typeof setTimeout> | null = null;
function scheduleFallback(fn: () => void): void {
  if (pendingFallback) clearTimeout(pendingFallback);
  pendingFallback = setTimeout(() => {
    pendingFallback = null;
    fn();
  }, 120);
}
function cancelFallback(): void {
  if (pendingFallback) clearTimeout(pendingFallback);
  pendingFallback = null;
}

/** Wire the system clipboard to the canvas (mount once in the editor). */
export function useClipboard(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onCopy = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;
      cancelFallback();
      const envelope = copySelection();
      if (!envelope) return;
      e.clipboardData?.setData('text/plain', JSON.stringify(envelope));
      e.preventDefault();
    };

    const onCut = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;
      cancelFallback();
      const envelope = copySelection();
      if (!envelope) return;
      e.clipboardData?.setData('text/plain', JSON.stringify(envelope));
      e.preventDefault();
      deleteSelection();
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      cancelFallback();
      const data = e.clipboardData;
      e.preventDefault();

      const image = Array.from(data?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (image) {
        const at = getCanvasController()?.getPasteAnchor() ?? { x: 0, y: 0 };
        void insertImageFile(image, at);
        return;
      }

      const text = data?.getData('text/plain') ?? '';
      const envelope = parseClipboardEnvelope(text);
      if (envelope) {
        useElementsStore.getState().setClipboardFromEnvelope(envelope);
        pasteInternal();
        return;
      }
      if (text.trim()) {
        pasteText(text);
        return;
      }
      pasteInternal();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'c') {
        // Keep the in-app clipboard current even if no copy event follows
        copySelection();
      } else if (key === 'x') {
        scheduleFallback(() => {
          copySelection();
          deleteSelection();
        });
      } else if (key === 'v') {
        scheduleFallback(() => pasteInternal());
      }
    };

    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKeyDown);
      cancelFallback();
    };
  }, [enabled]);
}

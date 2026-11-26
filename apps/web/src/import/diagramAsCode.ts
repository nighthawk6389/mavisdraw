import type { Point } from '@mavisdraw/types';
import { registerTextPasteHandler } from '../hooks/useClipboard';
import { toast } from '../stores/toastStore';
import { useElementsStore } from '../stores/elementsStore';
import { getCanvasController } from '../components/canvas/canvasController';

/** Cheap check (no parser loaded) for Mermaid flowchart text. */
export function looksLikeMermaid(text: string): boolean {
  return /^\s*(?:```\s*mermaid\s*\n)?(?:\s*%%[^\n]*\n)*\s*(?:graph|flowchart)\b/i.test(text);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Import Mermaid text into the active diagram, reporting the outcome. */
export async function importMermaidText(text: string, at: Point): Promise<boolean> {
  try {
    const [{ parseMermaidFlowchart }, { importMermaidGraph }] = await Promise.all([
      import('@mavisdraw/compat'),
      import('./mermaidImport'),
    ]);
    const graph = parseMermaidFlowchart(text);
    const result = await importMermaidGraph(graph, at);
    getCanvasController()?.invalidate();
    const shapes = graph.nodes.size;
    const nested = result.diagrams;
    toast(
      nested > 0
        ? `Imported ${plural(shapes, 'shape')} and ${plural(nested, 'nested diagram')} from Mermaid`
        : `Imported ${plural(shapes, 'shape')} from Mermaid`,
      'success',
      { label: 'Undo', run: () => useElementsStore.getState().undo() },
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast(`Couldn't import Mermaid: ${message}`, 'error');
    return false;
  }
}

let installed = false;

/** Paste Mermaid onto the canvas → an editable, nestable diagram. */
export function installDiagramAsCodePaste(): void {
  if (installed) return;
  installed = true;
  registerTextPasteHandler((text, at) => {
    if (!looksLikeMermaid(text)) return false;
    void importMermaidText(text, at);
    return true;
  });
}

import React, { useCallback, useRef } from 'react';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import type { ExcalidrawFile } from '@mavisdraw/compat';
import { importMermaidText, looksLikeMermaid } from '../../import/diagramAsCode';
import { getCanvasController } from '../canvas/canvasController';
import { toast } from '../../stores/toastStore';
import { remapImport } from '../../import/remapImport';
import { registerNewDiagram } from '../../services/diagramSync';

function detectFormat(
  filename: string,
  content: string | ArrayBuffer,
): 'mavisdraw' | 'excalidraw' | 'drawio' | 'png' | null {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (ext === 'mavisdraw') return 'mavisdraw';
  if (ext === 'excalidraw') return 'excalidraw';
  if (ext === 'drawio') return 'drawio';
  if (ext === 'png') return 'png';

  // Content sniffing for JSON files
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      if (parsed.type === 'mavisdraw') return 'mavisdraw';
      if (parsed.type === 'excalidraw') return 'excalidraw';
    } catch {
      // Not JSON — try XML
      if (content.includes('<mxfile') || content.includes('<mxGraphModel')) {
        return 'drawio';
      }
    }
  }

  return null;
}

export default function ImportHandler() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = useCallback(async (file: File) => {
    try {
      let content: string | ArrayBuffer;

      if (file.name.endsWith('.png')) {
        content = await file.arrayBuffer();
      } else {
        content = await file.text();
      }

      // Mermaid flowcharts import into the current diagram (subgraphs → nested diagrams)
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (
        typeof content === 'string' &&
        (ext === 'mmd' || ext === 'mermaid' || looksLikeMermaid(content))
      ) {
        const at = getCanvasController()?.getPasteAnchor() ?? { x: 0, y: 0 };
        await importMermaidText(content, at);
        return;
      }

      const format = detectFormat(file.name, content);
      if (!format) {
        toast(
          'Unsupported file. Supported: .mavisdraw, .excalidraw, .drawio, .png, Mermaid (.mmd)',
          'error',
        );
        return;
      }

      // Parsers load on demand so they don't weigh down the editor bundle
      const [{ importMavisDrawFile, importFromPng }, { importFromExcalidraw, importFromDrawio }] =
        await Promise.all([import('@mavisdraw/export'), import('@mavisdraw/compat')]);

      let diagrams: import('@mavisdraw/types').Diagram[] = [];
      let elements: import('@mavisdraw/types').MavisElement[] = [];
      let rootDiagramId: string | undefined;

      switch (format) {
        case 'mavisdraw': {
          const result = importMavisDrawFile(content as string);
          diagrams = result.diagrams;
          elements = result.elements;
          rootDiagramId = result.rootDiagramId;
          break;
        }
        case 'excalidraw': {
          const parsed = JSON.parse(content as string) as ExcalidrawFile;
          const result = importFromExcalidraw(parsed);
          diagrams = result.diagrams;
          elements = result.elements;
          break;
        }
        case 'drawio': {
          const result = importFromDrawio(content as string);
          diagrams = result.diagrams;
          elements = result.elements;
          break;
        }
        case 'png': {
          const result = importFromPng(content as ArrayBuffer);
          if (!result) {
            alert('This PNG does not contain embedded MavisDraw scene data.');
            return;
          }
          diagrams = result.diagrams;
          elements = result.elements;
          break;
        }
      }

      if (elements.length === 0 && diagrams.length === 0) {
        alert('No elements found in the imported file.');
        return;
      }

      // Into this project: the file's top level joins the diagram on screen,
      // its nested diagrams become this project's (fresh ids throughout, so
      // nothing is written back to where the file came from, and importing
      // twice doesn't collide). Nothing already here is replaced.
      const { diagrams: current, activeDiagramId } = useDiagramStore.getState();
      const target = current.get(activeDiagramId);
      if (!target) return;
      const imported = remapImport({ diagrams, elements, rootDiagramId }, target);

      // One undo step
      useElementsStore.getState().pushHistory();
      useDiagramStore.setState((prev) => {
        const next = new Map(prev.diagrams);
        for (const d of imported.diagrams) next.set(d.id, d);
        return { diagrams: next };
      });
      useElementsStore.setState((prev) => {
        const next = new Map(prev.elements);
        for (const el of imported.elements) next.set(el.id, el);
        return { elements: next };
      });
      for (const d of imported.diagrams) registerNewDiagram(d);

      alert(`Imported ${elements.length} elements from ${format} file.`);
    } catch (err) {
      console.error('Import failed:', err);
      alert(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleImport(file);
      // Reset input so the same file can be re-imported
      e.target.value = '';
    },
    [handleImport],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files[0];
      if (file) handleImport(file);
    },
    [handleImport],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mavisdraw,.excalidraw,.drawio,.png,.json,.xml,.mmd,.mermaid,.md,.txt"
        onChange={handleFileChange}
        className="hidden"
        id="import-file-input"
      />
      {/* Drop zone overlay (covers the canvas area) */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="absolute inset-0 pointer-events-none"
        style={{ pointerEvents: 'none' }}
      />
    </>
  );
}

/** Open the file picker programmatically. */
export function openImportDialog() {
  const input = document.getElementById('import-file-input') as HTMLInputElement;
  if (input) input.click();
}

import React, { useCallback, useRef } from 'react';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { importMavisDrawFile } from '@mavisdraw/export';
import { importFromPng } from '@mavisdraw/export';
import { importFromExcalidraw, importFromDrawio } from '@mavisdraw/compat';
import type { ExcalidrawFile } from '@mavisdraw/compat';

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

      const format = detectFormat(file.name, content);
      if (!format) {
        alert('Unsupported file format. Supported: .mavisdraw, .excalidraw, .drawio, .png');
        return;
      }

      let diagrams: import('@mavisdraw/types').Diagram[] = [];
      let elements: import('@mavisdraw/types').MavisElement[] = [];

      switch (format) {
        case 'mavisdraw': {
          const result = importMavisDrawFile(content as string);
          diagrams = result.diagrams;
          elements = result.elements;
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

      // Push current state to history before loading
      useElementsStore.getState().pushHistory();

      // Load imported elements
      useElementsStore.getState().setElements(elements);

      // Load diagrams
      const diagStore = useDiagramStore.getState();
      for (const diagram of diagrams) {
        if (!diagStore.diagrams.has(diagram.id)) {
          // Update the diagrams map directly
          diagStore.diagrams.set(diagram.id, diagram);
        }
      }

      // Navigate to first diagram
      if (diagrams.length > 0) {
        const root = diagrams.find((d) => !d.parentDiagramId) || diagrams[0];
        diagStore.navigateToDiagram(root.id);
      }

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
        accept=".mavisdraw,.excalidraw,.drawio,.png,.json,.xml"
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

import React, { useState, useCallback } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import {
  exportToMavisDrawFile,
  createMavisDrawBlob,
} from '@mavisdraw/export';
import { exportToSvg } from '@mavisdraw/export';
import {
  exportToExcalidraw,
  exportToDrawio,
  exportToMiro,
} from '@mavisdraw/compat';
import { serializeScene } from '@mavisdraw/llm';
import type { ExportFormat } from '@mavisdraw/types';

const FORMAT_OPTIONS: { value: ExportFormat; label: string; ext: string }[] = [
  { value: 'mavisdraw', label: 'MavisDraw (.mavisdraw)', ext: '.mavisdraw' },
  { value: 'png', label: 'PNG Image', ext: '.png' },
  { value: 'svg', label: 'SVG Image', ext: '.svg' },
  { value: 'pdf', label: 'PDF Document', ext: '.pdf' },
  { value: 'excalidraw', label: 'Excalidraw (.excalidraw)', ext: '.excalidraw' },
  { value: 'drawio', label: 'draw.io (.drawio)', ext: '.drawio' },
  { value: 'miro', label: 'Miro JSON', ext: '.json' },
  { value: 'llm-text', label: 'LLM-Readable Text (.md)', ext: '.md' },
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ExportDialog() {
  const showExportDialog = useUIStore((s) => s.showExportDialog);
  const toggleExportDialog = useUIStore((s) => s.toggleExportDialog);
  const renderMode = useUIStore((s) => s.renderMode);

  const [format, setFormat] = useState<ExportFormat>('mavisdraw');
  const [includeBackground, setIncludeBackground] = useState(true);
  const [scale, setScale] = useState(2);
  const [embedScene, setEmbedScene] = useState(true);
  const [includeNested, setIncludeNested] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const elementsMap = useElementsStore.getState().elements;
      const diagrams = Array.from(useDiagramStore.getState().diagrams.values());
      const activeDiagramId = useDiagramStore.getState().activeDiagramId;
      const rootDiagramId = useDiagramStore.getState().diagramPath[0] || activeDiagramId;

      const allElements = Array.from(elementsMap.values());
      const currentElements = includeNested
        ? allElements
        : allElements.filter((el) => el.diagramId === activeDiagramId);

      const diagramTitle = diagrams.find((d) => d.id === activeDiagramId)?.title || 'diagram';
      const filename = diagramTitle.replace(/[^a-zA-Z0-9-_]/g, '_');

      switch (format) {
        case 'mavisdraw': {
          const file = exportToMavisDrawFile(diagrams, currentElements, rootDiagramId, {
            renderMode,
            viewBackgroundColor: '#ffffff',
            gridEnabled: true,
            gridSize: 20,
          });
          const blob = createMavisDrawBlob(file);
          downloadBlob(blob, `${filename}.mavisdraw`);
          break;
        }

        case 'svg': {
          const svgString = exportToSvg(currentElements, {
            format: 'svg',
            includeBackground,
            scale: 1,
            includeNestedDiagrams: includeNested,
            renderMode,
            padding: 20,
          }, includeBackground ? '#ffffff' : undefined);
          const blob = new Blob([svgString], { type: 'image/svg+xml' });
          downloadBlob(blob, `${filename}.svg`);
          break;
        }

        case 'excalidraw': {
          const excFile = exportToExcalidraw(currentElements, {
            viewBackgroundColor: '#ffffff',
            gridSize: 20,
          });
          const blob = new Blob([JSON.stringify(excFile, null, 2)], {
            type: 'application/json',
          });
          downloadBlob(blob, `${filename}.excalidraw`);
          break;
        }

        case 'drawio': {
          const elementsByDiagram = new Map<string, typeof currentElements>();
          for (const el of currentElements) {
            const arr = elementsByDiagram.get(el.diagramId) ?? [];
            arr.push(el);
            elementsByDiagram.set(el.diagramId, arr);
          }
          const xml = exportToDrawio(diagrams, elementsByDiagram);
          const blob = new Blob([xml], { type: 'application/xml' });
          downloadBlob(blob, `${filename}.drawio`);
          break;
        }

        case 'miro': {
          const miroData = exportToMiro(currentElements);
          const blob = new Blob([JSON.stringify(miroData, null, 2)], {
            type: 'application/json',
          });
          downloadBlob(blob, `${filename}-miro.json`);
          break;
        }

        case 'llm-text': {
          const scene = {
            diagrams: includeNested ? diagrams : diagrams.filter((d) => d.id === activeDiagramId),
            elements: currentElements,
            rootDiagramId,
          };
          const markdown = serializeScene(scene, diagramTitle);
          const blob = new Blob([markdown], { type: 'text/markdown' });
          downloadBlob(blob, `${filename}.md`);
          break;
        }

        case 'png':
        case 'pdf':
          // PNG and PDF require canvas rendering — handled via exportRenderer
          // For now, show a message that these require the canvas
          alert(`${format.toUpperCase()} export requires canvas rendering. Use SVG or native format for now.`);
          break;
      }

      toggleExportDialog();
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Check console for details.');
    } finally {
      setIsExporting(false);
    }
  }, [format, includeBackground, scale, embedScene, includeNested, renderMode, toggleExportDialog]);

  if (!showExportDialog) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-lg shadow-xl w-[420px] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold text-gray-800">Export</h2>
          <button
            onClick={toggleExportDialog}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Format selector */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
              className="w-full border rounded px-2 py-1.5 text-sm bg-white"
            >
              {FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Format-specific options */}
          {(format === 'png' || format === 'svg' || format === 'pdf') && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={includeBackground}
                onChange={(e) => setIncludeBackground(e.target.checked)}
                className="rounded"
              />
              Include background
            </label>
          )}

          {format === 'png' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Scale</label>
                <select
                  value={scale}
                  onChange={(e) => setScale(Number(e.target.value))}
                  className="w-full border rounded px-2 py-1.5 text-sm bg-white"
                >
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={3}>3x</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={embedScene}
                  onChange={(e) => setEmbedScene(e.target.checked)}
                  className="rounded"
                />
                Embed scene data (for re-import)
              </label>
            </>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={includeNested}
              onChange={(e) => setIncludeNested(e.target.checked)}
              className="rounded"
            />
            Include nested diagrams
          </label>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t bg-gray-50 rounded-b-lg">
          <button
            onClick={toggleExportDialog}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}

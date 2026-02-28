import React, { useCallback, useMemo } from 'react';
import { useElementsStore } from '../../stores/elementsStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useDiagramStore } from '../../stores/diagramStore';
import type { PortalElement, PortalStyle } from '@mavisdraw/types';

const PORTAL_STYLES: { value: PortalStyle; label: string }[] = [
  { value: 'card', label: 'Card' },
  { value: 'badge', label: 'Badge' },
  { value: 'expanded', label: 'Expanded' },
];

export default function PortalProperties() {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const elements = useElementsStore((s) => s.elements);
  const updateElement = useElementsStore((s) => s.updateElement);
  const createDiagram = useDiagramStore((s) => s.createDiagram);
  const navigateToDiagram = useDiagramStore((s) => s.navigateToDiagram);
  const activeDiagramId = useDiagramStore((s) => s.activeDiagramId);
  const diagrams = useDiagramStore((s) => s.diagrams);

  // Get the selected portal element (if exactly one portal is selected)
  const selectedPortal = useMemo((): PortalElement | null => {
    if (selectedIds.size !== 1) return null;
    const id = Array.from(selectedIds)[0];
    const el = elements.get(id);
    if (!el || el.type !== 'portal') return null;
    return el as PortalElement;
  }, [selectedIds, elements]);

  // Get list of existing diagrams for linking
  const availableDiagrams = useMemo(() => {
    const result: { id: string; title: string }[] = [];
    for (const diagram of diagrams.values()) {
      // Exclude the current diagram itself and diagrams that are ancestors
      // (to prevent circular references)
      if (diagram.id !== activeDiagramId) {
        result.push({ id: diagram.id, title: diagram.title });
      }
    }
    return result.sort((a, b) => a.title.localeCompare(b.title));
  }, [diagrams, activeDiagramId]);

  const handleLabelChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedPortal) return;
      updateElement(selectedPortal.id, { label: e.target.value } as Partial<PortalElement>);
    },
    [selectedPortal, updateElement],
  );

  const handleStyleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!selectedPortal) return;
      updateElement(selectedPortal.id, {
        portalStyle: e.target.value as PortalStyle,
      } as Partial<PortalElement>);
    },
    [selectedPortal, updateElement],
  );

  const handleCreateChildDiagram = useCallback(() => {
    if (!selectedPortal) return;
    const diagram = createDiagram(
      activeDiagramId,
      selectedPortal.id,
      selectedPortal.label || 'New Diagram',
    );
    updateElement(selectedPortal.id, {
      targetDiagramId: diagram.id,
    } as Partial<PortalElement>);
  }, [selectedPortal, activeDiagramId, createDiagram, updateElement]);

  const handleLinkExisting = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!selectedPortal) return;
      const diagramId = e.target.value;
      if (diagramId) {
        updateElement(selectedPortal.id, {
          targetDiagramId: diagramId,
        } as Partial<PortalElement>);
      }
    },
    [selectedPortal, updateElement],
  );

  const handleDetach = useCallback(() => {
    if (!selectedPortal) return;
    updateElement(selectedPortal.id, {
      targetDiagramId: '',
      thumbnailDataUrl: null,
    } as Partial<PortalElement>);
  }, [selectedPortal, updateElement]);

  const handleEnterDiagram = useCallback(() => {
    if (!selectedPortal || !selectedPortal.targetDiagramId) return;
    navigateToDiagram(selectedPortal.targetDiagramId);
  }, [selectedPortal, navigateToDiagram]);

  if (!selectedPortal) return null;

  const hasTarget = selectedPortal.targetDiagramId !== '';
  const targetDiagram = hasTarget
    ? diagrams.get(selectedPortal.targetDiagramId)
    : null;

  return (
    <div
      className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 w-56"
      data-testid="portal-properties"
    >
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Portal Properties
      </h3>

      {/* Label */}
      <div className="mb-3">
        <label className="text-xs text-gray-500 block mb-1">Label</label>
        <input
          type="text"
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded
            focus:outline-none focus:border-blue-400"
          value={selectedPortal.label}
          onChange={handleLabelChange}
          placeholder="Portal label"
        />
      </div>

      {/* Portal style */}
      <div className="mb-3">
        <label className="text-xs text-gray-500 block mb-1">Style</label>
        <select
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded
            focus:outline-none focus:border-blue-400 bg-white"
          value={selectedPortal.portalStyle}
          onChange={handleStyleChange}
        >
          {PORTAL_STYLES.map((style) => (
            <option key={style.value} value={style.value}>
              {style.label}
            </option>
          ))}
        </select>
      </div>

      {/* Target info */}
      {hasTarget && targetDiagram && (
        <div className="mb-3 px-2 py-1.5 bg-blue-50 rounded text-xs text-blue-700">
          Linked to: <strong>{targetDiagram.title}</strong>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-1.5">
        {!hasTarget && (
          <>
            <button
              className="w-full text-left px-2 py-1.5 text-xs bg-blue-50 text-blue-700
                hover:bg-blue-100 rounded transition-colors"
              onClick={handleCreateChildDiagram}
            >
              Create New Child Diagram
            </button>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Link Existing</label>
              <select
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded
                  focus:outline-none focus:border-blue-400 bg-white"
                value=""
                onChange={handleLinkExisting}
              >
                <option value="">Select diagram...</option>
                {availableDiagrams.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {hasTarget && (
          <>
            <button
              className="w-full text-left px-2 py-1.5 text-xs bg-blue-50 text-blue-700
                hover:bg-blue-100 rounded transition-colors"
              onClick={handleEnterDiagram}
            >
              Enter Diagram
            </button>

            <button
              className="w-full text-left px-2 py-1.5 text-xs bg-gray-50 text-gray-600
                hover:bg-gray-100 rounded transition-colors"
              onClick={handleDetach}
            >
              Detach
            </button>
          </>
        )}
      </div>
    </div>
  );
}

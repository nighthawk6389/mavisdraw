import React, { useCallback, useRef } from 'react';
import { useLayerStore } from '../../stores/layerStore';
import { useUIStore } from '../../stores/uiStore';
import type { Layer } from '@mavisdraw/types';

export default function LayerPanel() {
  const showLayerPanel = useUIStore((s) => s.showLayerPanel);
  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const addLayer = useLayerStore((s) => s.addLayer);
  const deleteLayer = useLayerStore((s) => s.deleteLayer);
  const renameLayer = useLayerStore((s) => s.renameLayer);
  const setLayerVisibility = useLayerStore((s) => s.setLayerVisibility);
  const setLayerLocked = useLayerStore((s) => s.setLayerLocked);
  const setLayerOpacity = useLayerStore((s) => s.setLayerOpacity);
  const setActiveLayer = useLayerStore((s) => s.setActiveLayer);
  const reorderLayers = useLayerStore((s) => s.reorderLayers);

  // Drag state for reordering
  const dragIndexRef = useRef<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    dragIndexRef.current = index;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      const fromIndex = dragIndexRef.current;
      if (fromIndex !== null && fromIndex !== toIndex) {
        reorderLayers(fromIndex, toIndex);
      }
      dragIndexRef.current = null;
    },
    [reorderLayers],
  );

  if (!showLayerPanel) {
    return null;
  }

  // Display layers in reverse order (top layer first)
  const sortedLayers = [...layers].sort((a, b) => b.order - a.order);

  return (
    <aside className="w-56 bg-white border-l border-gray-200 overflow-y-auto flex flex-col z-10">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Layers
        </h3>
        <button
          className="text-xs text-blue-600 hover:text-blue-800 px-2 py-0.5 rounded hover:bg-blue-50"
          onClick={() => addLayer()}
        >
          + Add
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sortedLayers.map((layer, displayIndex) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            isActive={layer.id === activeLayerId}
            canDelete={layers.length > 1 && layer.id !== 'default'}
            onSelect={() => setActiveLayer(layer.id)}
            onToggleVisibility={() =>
              setLayerVisibility(layer.id, !layer.isVisible)
            }
            onToggleLock={() => setLayerLocked(layer.id, !layer.isLocked)}
            onOpacityChange={(opacity) => setLayerOpacity(layer.id, opacity)}
            onRename={(name) => renameLayer(layer.id, name)}
            onDelete={() => deleteLayer(layer.id)}
            onDragStart={() => handleDragStart(layer.order)}
            onDragOver={(e) => handleDragOver(e, layer.order)}
            onDrop={(e) => handleDrop(e, layer.order)}
          />
        ))}
      </div>
    </aside>
  );
}

// ─── Layer Row ────────────────────────────────────────────────

interface LayerRowProps {
  layer: Layer;
  isActive: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onOpacityChange: (opacity: number) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function LayerRow({
  layer,
  isActive,
  canDelete,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onOpacityChange,
  onRename,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
}: LayerRowProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [showOpacity, setShowOpacity] = React.useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = useCallback(() => {
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleRenameBlur = useCallback(() => {
    setIsEditing(false);
    if (inputRef.current) {
      const newName = inputRef.current.value.trim();
      if (newName) {
        onRename(newName);
      }
    }
  }, [onRename]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleRenameBlur();
      } else if (e.key === 'Escape') {
        setIsEditing(false);
      }
    },
    [handleRenameBlur],
  );

  return (
    <div
      className={`flex flex-col border-b border-gray-100 ${
        isActive ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        {/* Visibility toggle */}
        <button
          className={`w-5 h-5 flex items-center justify-center text-xs rounded ${
            layer.isVisible ? 'text-gray-600' : 'text-gray-300'
          }`}
          onClick={onToggleVisibility}
          title={layer.isVisible ? 'Hide layer' : 'Show layer'}
        >
          {layer.isVisible ? '\u{1F441}' : '\u25CB'}
        </button>

        {/* Lock toggle */}
        <button
          className={`w-5 h-5 flex items-center justify-center text-xs rounded ${
            layer.isLocked ? 'text-red-500' : 'text-gray-400'
          }`}
          onClick={onToggleLock}
          title={layer.isLocked ? 'Unlock layer' : 'Lock layer'}
        >
          {layer.isLocked ? '\u{1F512}' : '\u{1F513}'}
        </button>

        {/* Layer name */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={onSelect}
          onDoubleClick={handleDoubleClick}
        >
          {isEditing ? (
            <input
              ref={inputRef}
              className="w-full text-xs border border-blue-300 rounded px-1 py-0.5 outline-none"
              defaultValue={layer.name}
              onBlur={handleRenameBlur}
              onKeyDown={handleRenameKeyDown}
            />
          ) : (
            <span className="text-xs text-gray-700 truncate block">{layer.name}</span>
          )}
        </div>

        {/* Opacity toggle */}
        <button
          className="w-5 h-5 flex items-center justify-center text-xs text-gray-400 hover:text-gray-600"
          onClick={() => setShowOpacity(!showOpacity)}
          title={`Opacity: ${layer.opacity}%`}
        >
          {layer.opacity < 100 ? `${layer.opacity}` : '\u25CF'}
        </button>

        {/* Delete */}
        {canDelete && (
          <button
            className="w-5 h-5 flex items-center justify-center text-xs text-gray-400 hover:text-red-500"
            onClick={onDelete}
            title="Delete layer"
          >
            x
          </button>
        )}
      </div>

      {/* Opacity slider */}
      {showOpacity && (
        <div className="px-2 pb-1.5">
          <input
            type="range"
            min="0"
            max="100"
            value={layer.opacity}
            onChange={(e) => onOpacityChange(parseInt(e.target.value, 10))}
            className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      )}
    </div>
  );
}

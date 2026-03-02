import React from 'react';
import ToolButton from './ToolButton';
import { useToolStore, type Tool } from '../../stores/toolStore';
import { useUIStore } from '../../stores/uiStore';

interface ToolConfig {
  tool: Tool;
  icon: string;
  label: string;
  shortcut: string;
}

const TOOLS: ToolConfig[] = [
  { tool: 'select', icon: '\u25B3', label: 'Select', shortcut: 'V' },
  { tool: 'hand', icon: '\u270B', label: 'Hand (pan)', shortcut: 'H' },
  { tool: 'rectangle', icon: '\u25A1', label: 'Rectangle', shortcut: 'R' },
  { tool: 'ellipse', icon: '\u25CB', label: 'Ellipse', shortcut: 'E' },
  { tool: 'diamond', icon: '\u25C7', label: 'Diamond', shortcut: 'D' },
  { tool: 'line', icon: '\u2571', label: 'Line', shortcut: 'L' },
  { tool: 'arrow', icon: '\u2192', label: 'Arrow', shortcut: 'A' },
  { tool: 'freedraw', icon: '\u270E', label: 'Freedraw', shortcut: 'P' },
  { tool: 'text', icon: 'T', label: 'Text', shortcut: 'T' },
  { tool: 'portal', icon: '\u29C9', label: 'Portal', shortcut: 'O' },
];

export default function Toolbar() {
  const { activeTool, isToolLocked, setTool, toggleToolLock } = useToolStore();
  const {
    renderMode,
    setRenderMode,
    showGrid,
    toggleGrid,
    showStylePanel,
    toggleStylePanel,
    showLayerPanel,
    toggleLayerPanel,
    showDiagramTree,
    toggleDiagramTree,
  } = useUIStore();

  return (
    <aside data-testid="toolbar" className="w-12 bg-white border-r border-gray-200 flex flex-col items-center py-2 gap-1 z-10">
      {TOOLS.map((config) => (
        <ToolButton
          key={config.tool}
          icon={config.icon}
          label={config.label}
          shortcut={config.shortcut}
          isActive={activeTool === config.tool}
          onClick={() => setTool(config.tool)}
          onDoubleClick={() => {
            setTool(config.tool);
            toggleToolLock();
          }}
        />
      ))}

      {/* Divider */}
      <div className="w-8 h-px bg-gray-200 my-1" />

      {/* Render mode toggle */}
      <button
        className={`w-10 h-10 flex items-center justify-center rounded-lg text-xs font-medium
          transition-colors duration-150 group relative
          ${renderMode === 'sketchy' ? 'text-orange-600 bg-orange-50' : 'text-blue-600 bg-blue-50'}
        `}
        onClick={() => setRenderMode(renderMode === 'sketchy' ? 'clean' : 'sketchy')}
        title={`Mode: ${renderMode} (click to toggle)`}
      >
        {renderMode === 'sketchy' ? '\u270D' : '\u2662'}
        <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded
          opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
          {renderMode === 'sketchy' ? 'Sketchy mode' : 'Clean mode'}
        </span>
      </button>

      {/* Grid toggle */}
      <button
        className={`w-10 h-10 flex items-center justify-center rounded-lg text-xs
          transition-colors duration-150 group relative
          ${showGrid ? 'text-gray-700 bg-gray-100' : 'text-gray-400'}
        `}
        onClick={toggleGrid}
        title={`Grid: ${showGrid ? 'on' : 'off'}`}
      >
        #
        <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded
          opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
          Toggle grid
        </span>
      </button>

      {/* Diagram tree toggle */}
      <button
        className={`w-10 h-10 flex items-center justify-center rounded-lg text-xs
          transition-colors duration-150 group relative
          ${showDiagramTree ? 'text-purple-700 bg-purple-100' : 'text-gray-400'}
        `}
        onClick={toggleDiagramTree}
        title={`Diagram tree: ${showDiagramTree ? 'on' : 'off'}`}
      >
        {'\u2263'}
        <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded
          opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
          Diagram tree
        </span>
      </button>

      {/* Divider */}
      <div className="w-8 h-px bg-gray-200 my-1" />

      {/* Style panel toggle */}
      <button
        className={`w-10 h-10 flex items-center justify-center rounded-lg text-xs
          transition-colors duration-150 group relative
          ${showStylePanel ? 'text-purple-700 bg-purple-50' : 'text-gray-400'}
        `}
        onClick={toggleStylePanel}
        title={`Style panel: ${showStylePanel ? 'on' : 'off'}`}
      >
        S
        <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded
          opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
          Toggle style panel
        </span>
      </button>

      {/* Layer panel toggle */}
      <button
        className={`w-10 h-10 flex items-center justify-center rounded-lg text-xs
          transition-colors duration-150 group relative
          ${showLayerPanel ? 'text-green-700 bg-green-50' : 'text-gray-400'}
        `}
        onClick={toggleLayerPanel}
        title={`Layer panel: ${showLayerPanel ? 'on' : 'off'}`}
      >
        L
        <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded
          opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
          Toggle layer panel
        </span>
      </button>

      {/* Tool lock indicator */}
      {isToolLocked && (
        <div className="w-8 h-4 flex items-center justify-center text-xs text-blue-500 mt-auto">
          Locked
        </div>
      )}
    </aside>
  );
}

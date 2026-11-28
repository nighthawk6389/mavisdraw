import React from 'react';
import ToolButton from './ToolButton';
import { useToolStore, type Tool } from '../../stores/toolStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { useUIStore } from '../../stores/uiStore';
import { useThemeStore } from '../../stores/themeStore';
import { LibraryIcon } from '../library/LibraryIcon';

/** Lucide "eraser" (ISC). */
function EraserIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </svg>
  );
}

interface ToolConfig {
  tool: Tool;
  icon: React.ReactNode;
  label: string;
  shortcut: string;
}

const TOOLS: ToolConfig[] = [
  { tool: 'select', icon: '\u25B3', label: 'Select · Alt+drag to lasso', shortcut: 'V' },
  { tool: 'hand', icon: '\u270B', label: 'Hand (pan)', shortcut: 'H' },
  { tool: 'rectangle', icon: '\u25A1', label: 'Rectangle', shortcut: 'R' },
  { tool: 'ellipse', icon: '\u25CB', label: 'Ellipse', shortcut: 'E' },
  { tool: 'diamond', icon: '\u25C7', label: 'Diamond', shortcut: 'D' },
  { tool: 'cylinder', icon: <LibraryIcon id="database" size={18} />, label: 'Datastore', shortcut: 'B' },
  { tool: 'queue', icon: '\u2B2D', label: 'Queue', shortcut: 'U' },
  { tool: 'line', icon: '\u2571', label: 'Line', shortcut: 'L' },
  { tool: 'arrow', icon: '\u2192', label: 'Arrow', shortcut: 'A' },
  { tool: 'freedraw', icon: '\u270E', label: 'Freedraw', shortcut: 'P' },
  { tool: 'eraser', icon: <EraserIcon />, label: 'Eraser', shortcut: 'X' },
  { tool: 'text', icon: 'T', label: 'Text', shortcut: 'T' },
  { tool: 'portal', icon: '\u29C9', label: 'Portal', shortcut: 'O' },
  { tool: 'comment', icon: '\u{1F4AC}', label: 'Comment', shortcut: 'C' },
];

/** Its own component: switching themes re-renders this button, not every tool. */
function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      data-testid="theme-toggle"
      className="w-10 h-10 flex items-center justify-center rounded-lg text-base text-gray-600 hover:bg-gray-100 transition-colors duration-150 group relative"
      onClick={toggle}
      aria-label={`${label} (Shift+Alt+D)`}
      aria-pressed={theme === 'dark'}
      title={`${label} (Shift+Alt+D)`}
    >
      {theme === 'dark' ? '\u2600' : '\u263E'}
    </button>
  );
}

export default function Toolbar() {
  // One field each: the whole stores change for things the toolbar doesn't show
  const activeTool = useToolStore((s) => s.activeTool);
  const isToolLocked = useToolStore((s) => s.isToolLocked);
  const setTool = useToolStore((s) => s.setTool);
  const toggleToolLock = useToolStore((s) => s.toggleToolLock);
  const canEdit = usePermissionStore((s) => s.canEdit);
  // Viewers navigate and comment; they don't get drawing tools
  const tools = canEdit
    ? TOOLS
    : TOOLS.filter((t) => t.tool === 'select' || t.tool === 'hand' || t.tool === 'comment');
  const renderMode = useUIStore((s) => s.renderMode);
  const setRenderMode = useUIStore((s) => s.setRenderMode);
  const showGrid = useUIStore((s) => s.showGrid);
  const toggleGrid = useUIStore((s) => s.toggleGrid);
  const showStylePanel = useUIStore((s) => s.showStylePanel);
  const toggleStylePanel = useUIStore((s) => s.toggleStylePanel);
  const showLayerPanel = useUIStore((s) => s.showLayerPanel);
  const toggleLayerPanel = useUIStore((s) => s.toggleLayerPanel);
  const showDiagramTree = useUIStore((s) => s.showDiagramTree);
  const toggleDiagramTree = useUIStore((s) => s.toggleDiagramTree);
  const showLibrary = useUIStore((s) => s.showLibrary);
  const setShowLibrary = useUIStore((s) => s.setShowLibrary);

  return (
    <aside data-testid="toolbar" className="w-12 bg-white border-r border-gray-200 flex flex-col items-center py-2 gap-1 z-10">
      {tools.map((config) => (
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

      {/* Shape library: datastores, queues, cloud services, Kubernetes */}
      {canEdit && (
        <button
          data-testid="library-button"
          className={`w-10 h-10 flex items-center justify-center rounded-lg text-base
            transition-colors duration-150 group relative
            ${showLibrary ? 'text-blue-700 bg-blue-50' : 'text-gray-600 hover:bg-gray-100'}
          `}
          onClick={() => setShowLibrary(!showLibrary)}
          aria-pressed={showLibrary}
          title="Shape library"
        >
          {'\u25A6'}
          <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded
            opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
            Shape library: databases, queues, cloud services
          </span>
        </button>
      )}

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

      {/* Light / dark (Shift+Alt+D) */}
      <ThemeToggle />

      {/* Tool lock indicator */}
      {isToolLocked && (
        <div className="w-8 h-4 flex items-center justify-center text-xs text-blue-500 mt-auto">
          Locked
        </div>
      )}
    </aside>
  );
}

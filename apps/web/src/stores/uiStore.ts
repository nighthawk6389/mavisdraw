import { create } from 'zustand';
import type { RenderMode } from '@mavisdraw/types';

interface UIState {
  // Panels
  showStylePanel: boolean;
  showLayerPanel: boolean;
  /** The shape and icon library (architecture shapes, cloud services). */
  showLibrary: boolean;
  showDiagramTree: boolean;
  /** The overview in the corner (M). */
  showMinimap: boolean;
  /**
   * What a mouse wheel does: zoom (Miro, the default) or scroll the canvas
   * (Figma, Excalidraw). Trackpads always scroll, and pinch zooms.
   */
  mouseWheel: 'zoom' | 'scroll';

  // Dialogs
  showExportDialog: boolean;
  showVersionHistory: boolean;
  showGitHubDialog: boolean;

  // Agent chat
  showAgentChat: boolean;

  // Command palette & diagram-as-code import
  showCommandPalette: boolean;
  showMermaidDialog: boolean;
  /** "Connect a coding agent": MCP access tokens and setup. */
  showAgentAccess: boolean;
  /** Insert a template into the diagram on screen. */
  showTemplateDialog: boolean;

  // Diagram render mode
  renderMode: RenderMode;

  // Grid & snapping
  showGrid: boolean;
  snapToGrid: boolean;
  /** Smart guides: align to and space evenly with other shapes (hold Ctrl/Cmd to skip once). */
  snapToObjects: boolean;
  gridSize: number;

  // Actions
  toggleStylePanel: () => void;
  toggleLayerPanel: () => void;
  setShowLibrary: (open: boolean) => void;
  toggleDiagramTree: () => void;
  toggleMinimap: () => void;
  setMouseWheel: (mode: 'zoom' | 'scroll') => void;
  toggleExportDialog: () => void;
  toggleVersionHistory: () => void;
  toggleGitHubDialog: () => void;
  toggleAgentChat: () => void;
  setShowCommandPalette: (show: boolean) => void;
  setShowMermaidDialog: (show: boolean) => void;
  setShowAgentAccess: (show: boolean) => void;
  setShowTemplateDialog: (show: boolean) => void;
  setRenderMode: (mode: RenderMode) => void;
  toggleGrid: () => void;
  toggleSnapToGrid: () => void;
  toggleSnapToObjects: () => void;
  setGridSize: (size: number) => void;
}

/** Per-browser preferences (try/catch: storage can be blocked). */
const MINIMAP_KEY = 'mavisdraw:minimap';
const WHEEL_SCROLLS_KEY = 'mavisdraw:wheel-scrolls';
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // Lasts for this visit only
  }
}

export const useUIStore = create<UIState>((set) => ({
  showStylePanel: true,
  showLayerPanel: false,
  showLibrary: false,
  showDiagramTree: true,
  showMinimap: readFlag(MINIMAP_KEY),
  mouseWheel: readFlag(WHEEL_SCROLLS_KEY) ? 'scroll' : 'zoom',
  showExportDialog: false,
  showVersionHistory: false,
  showGitHubDialog: false,
  showAgentChat: false,
  showCommandPalette: false,
  showMermaidDialog: false,
  showAgentAccess: false,
  showTemplateDialog: false,
  renderMode: 'clean',
  showGrid: true,
  snapToGrid: false,
  snapToObjects: true,
  gridSize: 20,

  toggleStylePanel: () => {
    set((state) => ({ showStylePanel: !state.showStylePanel }));
  },

  toggleLayerPanel: () => {
    set((state) => ({ showLayerPanel: !state.showLayerPanel }));
  },

  setShowLibrary: (open) => set({ showLibrary: open }),

  toggleDiagramTree: () => {
    set((state) => ({ showDiagramTree: !state.showDiagramTree }));
  },

  toggleMinimap: () => {
    set((state) => {
      writeFlag(MINIMAP_KEY, !state.showMinimap);
      return { showMinimap: !state.showMinimap };
    });
  },

  setMouseWheel: (mode) => {
    writeFlag(WHEEL_SCROLLS_KEY, mode === 'scroll');
    set({ mouseWheel: mode });
  },

  toggleExportDialog: () => {
    set((state) => ({ showExportDialog: !state.showExportDialog }));
  },

  toggleVersionHistory: () => {
    set((state) => ({ showVersionHistory: !state.showVersionHistory }));
  },

  toggleGitHubDialog: () => {
    set((state) => ({ showGitHubDialog: !state.showGitHubDialog }));
  },

  toggleAgentChat: () => {
    set((state) => ({ showAgentChat: !state.showAgentChat }));
  },

  setShowCommandPalette: (show: boolean) => set({ showCommandPalette: show }),
  setShowMermaidDialog: (show: boolean) => set({ showMermaidDialog: show }),
  setShowAgentAccess: (show: boolean) => set({ showAgentAccess: show }),
  setShowTemplateDialog: (show: boolean) => set({ showTemplateDialog: show }),

  setRenderMode: (mode: RenderMode) => {
    set({ renderMode: mode });
  },

  toggleGrid: () => {
    set((state) => ({ showGrid: !state.showGrid }));
  },

  toggleSnapToGrid: () => {
    set((state) => ({ snapToGrid: !state.snapToGrid }));
  },

  toggleSnapToObjects: () => {
    set((state) => ({ snapToObjects: !state.snapToObjects }));
  },

  setGridSize: (size: number) => {
    set({ gridSize: size });
  },
}));

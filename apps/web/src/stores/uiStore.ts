import { create } from 'zustand';
import type { RenderMode } from '@mavisdraw/types';

interface UIState {
  // Panels
  showStylePanel: boolean;
  showLayerPanel: boolean;
  showDiagramTree: boolean;

  // Diagram render mode
  renderMode: RenderMode;

  // Grid
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;

  // Actions
  toggleStylePanel: () => void;
  toggleLayerPanel: () => void;
  toggleDiagramTree: () => void;
  setRenderMode: (mode: RenderMode) => void;
  toggleGrid: () => void;
  toggleSnapToGrid: () => void;
  setGridSize: (size: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  showStylePanel: true,
  showLayerPanel: false,
  showDiagramTree: false,
  renderMode: 'sketchy',
  showGrid: true,
  snapToGrid: false,
  gridSize: 20,

  toggleStylePanel: () => {
    set((state) => ({ showStylePanel: !state.showStylePanel }));
  },

  toggleLayerPanel: () => {
    set((state) => ({ showLayerPanel: !state.showLayerPanel }));
  },

  toggleDiagramTree: () => {
    set((state) => ({ showDiagramTree: !state.showDiagramTree }));
  },

  setRenderMode: (mode: RenderMode) => {
    set({ renderMode: mode });
  },

  toggleGrid: () => {
    set((state) => ({ showGrid: !state.showGrid }));
  },

  toggleSnapToGrid: () => {
    set((state) => ({ snapToGrid: !state.snapToGrid }));
  },

  setGridSize: (size: number) => {
    set({ gridSize: size });
  },
}));

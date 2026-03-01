import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Layer } from '@mavisdraw/types';

interface LayerState {
  layers: Layer[];
  activeLayerId: string;

  // Actions
  addLayer: (name?: string) => Layer;
  deleteLayer: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  setLayerVisibility: (id: string, isVisible: boolean) => void;
  setLayerLocked: (id: string, isLocked: boolean) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  setActiveLayer: (id: string) => void;

  // Queries
  getLayer: (id: string) => Layer | undefined;
  getVisibleLayerIds: () => Set<string>;
  getLockedLayerIds: () => Set<string>;
  isLayerVisible: (id: string) => boolean;
  isLayerLocked: (id: string) => boolean;
}

const DEFAULT_LAYER: Layer = {
  id: 'default',
  name: 'Layer 1',
  isVisible: true,
  isLocked: false,
  opacity: 100,
  order: 0,
};

export const useLayerStore = create<LayerState>((set, get) => ({
  layers: [DEFAULT_LAYER],
  activeLayerId: 'default',

  addLayer: (name?: string): Layer => {
    const state = get();
    const order = state.layers.length;
    const layer: Layer = {
      id: nanoid(),
      name: name || `Layer ${order + 1}`,
      isVisible: true,
      isLocked: false,
      opacity: 100,
      order,
    };

    set((prev) => ({
      layers: [...prev.layers, layer],
      activeLayerId: layer.id,
    }));

    return layer;
  },

  deleteLayer: (id: string) => {
    const state = get();
    // Don't delete the last layer
    if (state.layers.length <= 1) return;
    // Don't delete the default layer
    if (id === 'default') return;

    set((prev) => {
      const newLayers = prev.layers
        .filter((l) => l.id !== id)
        .map((l, i) => ({ ...l, order: i }));

      // If we deleted the active layer, switch to the first layer
      const newActiveId = prev.activeLayerId === id ? newLayers[0].id : prev.activeLayerId;

      return {
        layers: newLayers,
        activeLayerId: newActiveId,
      };
    });
  },

  renameLayer: (id: string, name: string) => {
    set((prev) => ({
      layers: prev.layers.map((l) => (l.id === id ? { ...l, name } : l)),
    }));
  },

  setLayerVisibility: (id: string, isVisible: boolean) => {
    set((prev) => ({
      layers: prev.layers.map((l) => (l.id === id ? { ...l, isVisible } : l)),
    }));
  },

  setLayerLocked: (id: string, isLocked: boolean) => {
    set((prev) => ({
      layers: prev.layers.map((l) => (l.id === id ? { ...l, isLocked } : l)),
    }));
  },

  setLayerOpacity: (id: string, opacity: number) => {
    const clamped = Math.max(0, Math.min(100, opacity));
    set((prev) => ({
      layers: prev.layers.map((l) => (l.id === id ? { ...l, opacity: clamped } : l)),
    }));
  },

  reorderLayers: (fromIndex: number, toIndex: number) => {
    set((prev) => {
      const newLayers = [...prev.layers];
      const [moved] = newLayers.splice(fromIndex, 1);
      newLayers.splice(toIndex, 0, moved);
      return {
        layers: newLayers.map((l, i) => ({ ...l, order: i })),
      };
    });
  },

  setActiveLayer: (id: string) => {
    set({ activeLayerId: id });
  },

  getLayer: (id: string) => {
    return get().layers.find((l) => l.id === id);
  },

  getVisibleLayerIds: () => {
    return new Set(get().layers.filter((l) => l.isVisible).map((l) => l.id));
  },

  getLockedLayerIds: () => {
    return new Set(get().layers.filter((l) => l.isLocked).map((l) => l.id));
  },

  isLayerVisible: (id: string) => {
    const layer = get().layers.find((l) => l.id === id);
    return layer ? layer.isVisible : true;
  },

  isLayerLocked: (id: string) => {
    const layer = get().layers.find((l) => l.id === id);
    return layer ? layer.isLocked : false;
  },
}));

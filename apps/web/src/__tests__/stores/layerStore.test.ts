import { describe, it, expect, beforeEach } from 'vitest';
import { useLayerStore } from '../../stores/layerStore';

function resetStore() {
  useLayerStore.setState({
    layers: [
      {
        id: 'default',
        name: 'Layer 1',
        isVisible: true,
        isLocked: false,
        opacity: 100,
        order: 0,
      },
    ],
    activeLayerId: 'default',
  });
}

describe('layerStore', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('initial state', () => {
    it('has one default layer', () => {
      const state = useLayerStore.getState();
      expect(state.layers).toHaveLength(1);
      expect(state.layers[0].id).toBe('default');
      expect(state.layers[0].name).toBe('Layer 1');
    });

    it('default layer is active', () => {
      expect(useLayerStore.getState().activeLayerId).toBe('default');
    });
  });

  describe('addLayer', () => {
    it('adds a new layer with generated name', () => {
      const layer = useLayerStore.getState().addLayer();
      expect(layer.name).toBe('Layer 2');
      expect(useLayerStore.getState().layers).toHaveLength(2);
    });

    it('adds a new layer with custom name', () => {
      const layer = useLayerStore.getState().addLayer('My Layer');
      expect(layer.name).toBe('My Layer');
    });

    it('sets the new layer as active', () => {
      const layer = useLayerStore.getState().addLayer();
      expect(useLayerStore.getState().activeLayerId).toBe(layer.id);
    });

    it('assigns correct order', () => {
      const layer = useLayerStore.getState().addLayer();
      expect(layer.order).toBe(1);
    });
  });

  describe('deleteLayer', () => {
    it('deletes a non-default layer', () => {
      const layer = useLayerStore.getState().addLayer();
      useLayerStore.getState().deleteLayer(layer.id);
      expect(useLayerStore.getState().layers).toHaveLength(1);
    });

    it('does not delete the default layer', () => {
      useLayerStore.getState().deleteLayer('default');
      expect(useLayerStore.getState().layers).toHaveLength(1);
    });

    it('does not delete the last layer', () => {
      expect(useLayerStore.getState().layers).toHaveLength(1);
      useLayerStore.getState().deleteLayer('default');
      expect(useLayerStore.getState().layers).toHaveLength(1);
    });

    it('switches active layer when deleting active', () => {
      const layer = useLayerStore.getState().addLayer();
      useLayerStore.getState().setActiveLayer(layer.id);
      useLayerStore.getState().deleteLayer(layer.id);
      expect(useLayerStore.getState().activeLayerId).toBe('default');
    });
  });

  describe('renameLayer', () => {
    it('renames a layer', () => {
      useLayerStore.getState().renameLayer('default', 'Background');
      expect(useLayerStore.getState().layers[0].name).toBe('Background');
    });
  });

  describe('setLayerVisibility', () => {
    it('toggles layer visibility', () => {
      useLayerStore.getState().setLayerVisibility('default', false);
      expect(useLayerStore.getState().layers[0].isVisible).toBe(false);

      useLayerStore.getState().setLayerVisibility('default', true);
      expect(useLayerStore.getState().layers[0].isVisible).toBe(true);
    });
  });

  describe('setLayerLocked', () => {
    it('toggles layer lock', () => {
      useLayerStore.getState().setLayerLocked('default', true);
      expect(useLayerStore.getState().layers[0].isLocked).toBe(true);

      useLayerStore.getState().setLayerLocked('default', false);
      expect(useLayerStore.getState().layers[0].isLocked).toBe(false);
    });
  });

  describe('setLayerOpacity', () => {
    it('sets layer opacity', () => {
      useLayerStore.getState().setLayerOpacity('default', 50);
      expect(useLayerStore.getState().layers[0].opacity).toBe(50);
    });

    it('clamps opacity to 0-100', () => {
      useLayerStore.getState().setLayerOpacity('default', -10);
      expect(useLayerStore.getState().layers[0].opacity).toBe(0);

      useLayerStore.getState().setLayerOpacity('default', 150);
      expect(useLayerStore.getState().layers[0].opacity).toBe(100);
    });
  });

  describe('reorderLayers', () => {
    it('reorders layers', () => {
      useLayerStore.getState().addLayer('Layer 2');
      useLayerStore.getState().addLayer('Layer 3');

      const layers = useLayerStore.getState().layers;
      expect(layers[0].name).toBe('Layer 1');
      expect(layers[1].name).toBe('Layer 2');
      expect(layers[2].name).toBe('Layer 3');

      useLayerStore.getState().reorderLayers(0, 2);

      const reordered = useLayerStore.getState().layers;
      expect(reordered[0].name).toBe('Layer 2');
      expect(reordered[1].name).toBe('Layer 3');
      expect(reordered[2].name).toBe('Layer 1');
    });

    it('updates order values correctly', () => {
      useLayerStore.getState().addLayer();
      useLayerStore.getState().reorderLayers(0, 1);

      const layers = useLayerStore.getState().layers;
      expect(layers[0].order).toBe(0);
      expect(layers[1].order).toBe(1);
    });
  });

  describe('queries', () => {
    it('getLayer returns correct layer', () => {
      const layer = useLayerStore.getState().getLayer('default');
      expect(layer).toBeDefined();
      expect(layer!.id).toBe('default');
    });

    it('getLayer returns undefined for non-existent', () => {
      expect(useLayerStore.getState().getLayer('non-existent')).toBeUndefined();
    });

    it('getVisibleLayerIds returns visible layers', () => {
      useLayerStore.getState().addLayer();
      const visibleIds = useLayerStore.getState().getVisibleLayerIds();
      expect(visibleIds.size).toBe(2);
    });

    it('getVisibleLayerIds excludes hidden layers', () => {
      const newLayer = useLayerStore.getState().addLayer();
      useLayerStore.getState().setLayerVisibility(newLayer.id, false);
      const visibleIds = useLayerStore.getState().getVisibleLayerIds();
      expect(visibleIds.size).toBe(1);
      expect(visibleIds.has('default')).toBe(true);
    });

    it('getLockedLayerIds returns locked layers', () => {
      useLayerStore.getState().setLayerLocked('default', true);
      const lockedIds = useLayerStore.getState().getLockedLayerIds();
      expect(lockedIds.has('default')).toBe(true);
    });

    it('isLayerVisible returns correct state', () => {
      expect(useLayerStore.getState().isLayerVisible('default')).toBe(true);
      useLayerStore.getState().setLayerVisibility('default', false);
      expect(useLayerStore.getState().isLayerVisible('default')).toBe(false);
    });

    it('isLayerLocked returns correct state', () => {
      expect(useLayerStore.getState().isLayerLocked('default')).toBe(false);
      useLayerStore.getState().setLayerLocked('default', true);
      expect(useLayerStore.getState().isLayerLocked('default')).toBe(true);
    });

    it('isLayerVisible returns true for non-existent layer', () => {
      expect(useLayerStore.getState().isLayerVisible('non-existent')).toBe(true);
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../../stores/uiStore';

function resetStore() {
  useUIStore.setState({
    showStylePanel: true,
    showLayerPanel: false,
    showDiagramTree: false,
    showExportDialog: false,
    showVersionHistory: false,
    showGitHubDialog: false,
    showAgentChat: false,
    renderMode: 'sketchy',
    showGrid: true,
    snapToGrid: false,
    gridSize: 20,
  });
}

describe('uiStore', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('initial state', () => {
    it('has correct defaults', () => {
      const state = useUIStore.getState();
      expect(state.showStylePanel).toBe(true);
      expect(state.showLayerPanel).toBe(false);
      expect(state.showGitHubDialog).toBe(false);
      expect(state.renderMode).toBe('sketchy');
      expect(state.showGrid).toBe(true);
      expect(state.snapToGrid).toBe(false);
      expect(state.gridSize).toBe(20);
    });
  });

  describe('toggleStylePanel', () => {
    it('toggles style panel visibility', () => {
      useUIStore.getState().toggleStylePanel();
      expect(useUIStore.getState().showStylePanel).toBe(false);
      useUIStore.getState().toggleStylePanel();
      expect(useUIStore.getState().showStylePanel).toBe(true);
    });
  });

  describe('toggleLayerPanel', () => {
    it('toggles layer panel visibility', () => {
      useUIStore.getState().toggleLayerPanel();
      expect(useUIStore.getState().showLayerPanel).toBe(true);
      useUIStore.getState().toggleLayerPanel();
      expect(useUIStore.getState().showLayerPanel).toBe(false);
    });
  });

  describe('setRenderMode', () => {
    it('sets render mode to clean', () => {
      useUIStore.getState().setRenderMode('clean');
      expect(useUIStore.getState().renderMode).toBe('clean');
    });

    it('sets render mode to sketchy', () => {
      useUIStore.getState().setRenderMode('clean');
      useUIStore.getState().setRenderMode('sketchy');
      expect(useUIStore.getState().renderMode).toBe('sketchy');
    });
  });

  describe('toggleGrid', () => {
    it('toggles grid visibility', () => {
      useUIStore.getState().toggleGrid();
      expect(useUIStore.getState().showGrid).toBe(false);
      useUIStore.getState().toggleGrid();
      expect(useUIStore.getState().showGrid).toBe(true);
    });
  });

  describe('toggleSnapToGrid', () => {
    it('toggles snap to grid', () => {
      useUIStore.getState().toggleSnapToGrid();
      expect(useUIStore.getState().snapToGrid).toBe(true);
      useUIStore.getState().toggleSnapToGrid();
      expect(useUIStore.getState().snapToGrid).toBe(false);
    });
  });

  describe('toggleGitHubDialog', () => {
    it('toggles GitHub dialog visibility', () => {
      useUIStore.getState().toggleGitHubDialog();
      expect(useUIStore.getState().showGitHubDialog).toBe(true);
      useUIStore.getState().toggleGitHubDialog();
      expect(useUIStore.getState().showGitHubDialog).toBe(false);
    });
  });

  describe('toggleAgentChat', () => {
    it('toggles agent chat visibility', () => {
      useUIStore.getState().toggleAgentChat();
      expect(useUIStore.getState().showAgentChat).toBe(true);
      useUIStore.getState().toggleAgentChat();
      expect(useUIStore.getState().showAgentChat).toBe(false);
    });
  });

  describe('setGridSize', () => {
    it('sets grid size', () => {
      useUIStore.getState().setGridSize(40);
      expect(useUIStore.getState().gridSize).toBe(40);
    });

    it('accepts small grid sizes', () => {
      useUIStore.getState().setGridSize(5);
      expect(useUIStore.getState().gridSize).toBe(5);
    });
  });
});

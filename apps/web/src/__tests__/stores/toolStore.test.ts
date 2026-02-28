import { describe, it, expect, beforeEach } from 'vitest';
import { useToolStore } from '../../stores/toolStore';

function resetStore() {
  useToolStore.setState({
    activeTool: 'select',
    isToolLocked: false,
  });
}

describe('toolStore', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('initial state', () => {
    it('starts with select tool', () => {
      expect(useToolStore.getState().activeTool).toBe('select');
    });

    it('starts with tool unlocked', () => {
      expect(useToolStore.getState().isToolLocked).toBe(false);
    });
  });

  describe('setTool', () => {
    it('changes the active tool', () => {
      useToolStore.getState().setTool('rectangle');
      expect(useToolStore.getState().activeTool).toBe('rectangle');
    });

    it('resets tool lock when changing tools', () => {
      useToolStore.getState().toggleToolLock();
      expect(useToolStore.getState().isToolLocked).toBe(true);
      useToolStore.getState().setTool('ellipse');
      expect(useToolStore.getState().isToolLocked).toBe(false);
    });

    it('can set all tool types', () => {
      const tools = ['select', 'rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'freedraw', 'text', 'portal', 'hand'] as const;
      for (const tool of tools) {
        useToolStore.getState().setTool(tool);
        expect(useToolStore.getState().activeTool).toBe(tool);
      }
    });
  });

  describe('toggleToolLock', () => {
    it('toggles tool lock on', () => {
      useToolStore.getState().toggleToolLock();
      expect(useToolStore.getState().isToolLocked).toBe(true);
    });

    it('toggles tool lock off', () => {
      useToolStore.getState().toggleToolLock();
      useToolStore.getState().toggleToolLock();
      expect(useToolStore.getState().isToolLocked).toBe(false);
    });
  });

  describe('resetToSelect', () => {
    it('resets to select tool when not locked', () => {
      useToolStore.getState().setTool('rectangle');
      useToolStore.getState().resetToSelect();
      expect(useToolStore.getState().activeTool).toBe('select');
    });

    it('does not reset when tool is locked', () => {
      useToolStore.getState().setTool('rectangle');
      useToolStore.getState().toggleToolLock();
      useToolStore.getState().resetToSelect();
      expect(useToolStore.getState().activeTool).toBe('rectangle');
    });
  });
});

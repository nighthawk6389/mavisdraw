import { create } from 'zustand';

export type Tool =
  | 'select'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'freedraw'
  | 'text'
  | 'portal'
  | 'hand';

interface ToolState {
  activeTool: Tool;
  isToolLocked: boolean;

  setTool: (tool: Tool) => void;
  toggleToolLock: () => void;
  resetToSelect: () => void;
}

export const useToolStore = create<ToolState>((set, get) => ({
  activeTool: 'select',
  isToolLocked: false,

  setTool: (tool: Tool) => {
    set({ activeTool: tool, isToolLocked: false });
  },

  toggleToolLock: () => {
    set((prev) => ({ isToolLocked: !prev.isToolLocked }));
  },

  resetToSelect: () => {
    const state = get();
    if (!state.isToolLocked) {
      set({ activeTool: 'select' });
    }
  },
}));

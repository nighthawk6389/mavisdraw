import { useEffect, useCallback } from 'react';
import { useToolStore, type Tool } from '../stores/toolStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useElementsStore } from '../stores/elementsStore';

const KEY_TO_TOOL: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  r: 'rectangle',
  e: 'ellipse',
  d: 'diamond',
  l: 'line',
  a: 'arrow',
  p: 'freedraw',
  t: 'text',
};

export function useKeyboard(
  interactionManagerRef: React.MutableRefObject<{ setSpacePressed: (p: boolean) => void } | null>,
) {
  const setTool = useToolStore((s) => s.setTool);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const selectAll = useSelectionStore((s) => s.selectAll);
  const undo = useElementsStore((s) => s.undo);
  const redo = useElementsStore((s) => s.redo);
  const deleteElements = useElementsStore((s) => s.deleteElements);
  const elements = useElementsStore((s) => s.elements);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't handle if typing in an input
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const key = event.key.toLowerCase();
      const isCtrlOrMeta = event.ctrlKey || event.metaKey;

      // Space = toggle pan mode
      if (key === ' ') {
        event.preventDefault();
        interactionManagerRef.current?.setSpacePressed(true);
        return;
      }

      // Escape = deselect / cancel
      if (key === 'escape') {
        clearSelection();
        setTool('select');
        return;
      }

      // Delete / Backspace = delete selected
      if (key === 'delete' || key === 'backspace') {
        if (selectedIds.size > 0) {
          event.preventDefault();
          deleteElements(Array.from(selectedIds));
          clearSelection();
        }
        return;
      }

      // Ctrl+Z = undo
      if (isCtrlOrMeta && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      // Ctrl+Shift+Z or Ctrl+Y = redo
      if ((isCtrlOrMeta && key === 'z' && event.shiftKey) || (isCtrlOrMeta && key === 'y')) {
        event.preventDefault();
        redo();
        return;
      }

      // Ctrl+A = select all
      if (isCtrlOrMeta && key === 'a') {
        event.preventDefault();
        const allIds = Array.from(elements.values())
          .filter((el) => !el.isDeleted)
          .map((el) => el.id);
        selectAll(allIds);
        return;
      }

      // Tool shortcuts (only without modifiers)
      if (!isCtrlOrMeta && !event.altKey) {
        const tool = KEY_TO_TOOL[key];
        if (tool) {
          setTool(tool);
          return;
        }
      }
    },
    [selectedIds, elements, clearSelection, selectAll, setTool, undo, redo, deleteElements],
  );

  const handleKeyUp = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === ' ') {
        interactionManagerRef.current?.setSpacePressed(false);
      }
    },
    [],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);
}

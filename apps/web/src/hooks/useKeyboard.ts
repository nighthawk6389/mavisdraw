import { useEffect, useCallback } from 'react';
import { useToolStore, type Tool } from '../stores/toolStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useElementsStore } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';
import { useUIStore } from '../stores/uiStore';

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
  o: 'portal',
};

export function useKeyboard(
  interactionManagerRef: React.MutableRefObject<{ setSpacePressed: (p: boolean) => void } | null>,
) {
  const setTool = useToolStore((s) => s.setTool);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const selectAll = useSelectionStore((s) => s.selectAll);
  const selectMultiple = useSelectionStore((s) => s.selectMultiple);
  const undo = useElementsStore((s) => s.undo);
  const redo = useElementsStore((s) => s.redo);
  const deleteElements = useElementsStore((s) => s.deleteElements);
  const groupElements = useElementsStore((s) => s.groupElements);
  const ungroupElements = useElementsStore((s) => s.ungroupElements);
  const copyElements = useElementsStore((s) => s.copyElements);
  const pasteElements = useElementsStore((s) => s.pasteElements);
  const duplicateElements = useElementsStore((s) => s.duplicateElements);
  const activeDiagramId = useDiagramStore((s) => s.activeDiagramId);
  const diagramPath = useDiagramStore((s) => s.diagramPath);

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

      // Delete / Backspace = delete selected (or remove waypoint if moving one)
      if (key === 'delete' || key === 'backspace') {
        const mgr = interactionManagerRef.current as { setSpacePressed: (p: boolean) => void; handleKeyDown?: (e: KeyboardEvent) => boolean } | null;
        if (mgr?.handleKeyDown?.(event)) return;
        if (selectedIds.size > 0) {
          event.preventDefault();
          deleteElements(Array.from(selectedIds));
          clearSelection();
        } else if (key === 'backspace' && diagramPath.length > 1) {
          // Navigate up when no selection and not at root
          event.preventDefault();
          useDiagramStore.getState().navigateUp();
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
        const currentElements = useElementsStore.getState().elements;
        const allIds = Array.from(currentElements.values())
          .filter((el) => !el.isDeleted && el.diagramId === activeDiagramId)
          .map((el) => el.id);
        selectAll(allIds);
        return;
      }

      // Ctrl+G = group
      if (isCtrlOrMeta && key === 'g' && !event.shiftKey) {
        event.preventDefault();
        if (selectedIds.size >= 2) {
          groupElements(Array.from(selectedIds));
        }
        return;
      }

      // Ctrl+Shift+G = ungroup
      if (isCtrlOrMeta && key === 'g' && event.shiftKey) {
        event.preventDefault();
        if (selectedIds.size > 0) {
          ungroupElements(Array.from(selectedIds));
        }
        return;
      }

      // Ctrl+C = copy
      if (isCtrlOrMeta && key === 'c') {
        event.preventDefault();
        if (selectedIds.size > 0) {
          copyElements(Array.from(selectedIds));
        }
        return;
      }

      // Ctrl+V = paste
      if (isCtrlOrMeta && key === 'v') {
        event.preventDefault();
        const pasted = pasteElements(activeDiagramId);
        if (pasted.length > 0) {
          selectMultiple(pasted.map((el) => el.id));
        }
        return;
      }

      // Ctrl+D = duplicate
      if (isCtrlOrMeta && key === 'd') {
        event.preventDefault();
        if (selectedIds.size > 0) {
          const duplicated = duplicateElements(Array.from(selectedIds));
          if (duplicated.length > 0) {
            selectMultiple(duplicated.map((el) => el.id));
          }
        }
        return;
      }

      // Ctrl+X = cut (copy + delete)
      if (isCtrlOrMeta && key === 'x') {
        event.preventDefault();
        if (selectedIds.size > 0) {
          copyElements(Array.from(selectedIds));
          deleteElements(Array.from(selectedIds));
          clearSelection();
        }
        return;
      }

      // Ctrl+Shift+T = toggle diagram tree sidebar
      if (isCtrlOrMeta && event.shiftKey && key === 't') {
        event.preventDefault();
        useUIStore.getState().toggleDiagramTree();
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
    [
      selectedIds,
      activeDiagramId,
      diagramPath,
      clearSelection,
      selectAll,
      selectMultiple,
      setTool,
      undo,
      redo,
      deleteElements,
      groupElements,
      ungroupElements,
      copyElements,
      pasteElements,
      duplicateElements,
    ],
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

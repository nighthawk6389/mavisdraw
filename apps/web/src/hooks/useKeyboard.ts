import { useEffect } from 'react';
import { useCommentsStore } from '../stores/commentsStore';
import { useVersionStore } from '../stores/versionStore';
import { useToolStore, type Tool } from '../stores/toolStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useElementsStore } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';
import { useUIStore } from '../stores/uiStore';
import { openImportDialog } from '../components/export/ImportHandler';
import { getCanvasController } from '../components/canvas/canvasController';
import * as actions from '../editor/actions';
import { canEdit } from '../stores/permissionStore';

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
  c: 'comment',
};

const NUDGE_KEYS: Record<string, [number, number]> = {
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  arrowup: [0, -1],
  arrowdown: [0, 1],
};

/** Move the selection by (dx, dy); repeated nudges merge into one undo step. */
function nudgeSelection(dx: number, dy: number): void {
  const ids = useSelectionStore.getState().selectedIds;
  if (ids.size === 0) return;
  const store = useElementsStore.getState();
  store.pushHistory('nudge');
  for (const id of ids) {
    const el = store.elements.get(id);
    if (!el || el.isDeleted || el.isLocked) continue;
    if (el.type === 'text' && el.containerId && ids.has(el.containerId)) continue;
    useElementsStore.getState().moveElementWithBindings(id, el.x + dx, el.y + dy);
  }
  getCanvasController()?.invalidate();
}

/**
 * Global editor shortcuts. Reads store state at keypress time so the
 * listener is bound once instead of on every selection change.
 * Copy/cut/paste are handled by useClipboard via real clipboard events.
 */
export function useKeyboard(
  interactionManagerRef: React.MutableRefObject<{ setSpacePressed: (p: boolean) => void } | null>,
) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const key = event.key.toLowerCase();
      const code = event.code;
      const mod = event.ctrlKey || event.metaKey;
      const selectedIds = useSelectionStore.getState().selectedIds;
      const editable = canEdit();

      // Viewers: navigation, selection, search, copy/export only
      if (!editable) {
        if (key === 'enter' && selectedIds.size === 1) {
          const [id] = Array.from(selectedIds);
          if (useElementsStore.getState().elements.get(id)?.type === 'portal') {
            event.preventDefault();
            getCanvasController()?.openPortal?.(id);
          }
          return;
        }
        if (key === 'backspace' && selectedIds.size === 0 && useDiagramStore.getState().diagramPath.length > 1) {
          event.preventDefault();
          useDiagramStore.getState().navigateUp();
          return;
        }
        const allowed =
          (mod && ['a', 'k', '=', '+', '-', '0'].includes(key)) ||
          (event.shiftKey && !mod && (code === 'Digit1' || code === 'Digit2')) ||
          (event.shiftKey && event.altKey && code === 'KeyC') ||
          (mod && event.shiftKey && (key === 'e' || key === 't')) ||
          key === 'escape' ||
          (!mod && !event.altKey && ['v', 'h', 'c', ' '].includes(key));
        if (!allowed) return;
      }

      // Space = temporary pan mode
      if (key === ' ') {
        event.preventDefault();
        interactionManagerRef.current?.setSpacePressed(true);
        return;
      }

      if (key === 'escape') {
        // Mid-drag / resize / draw: put everything back as it was (tldraw, Figma)
        const gesture = interactionManagerRef.current as {
          isGestureActive?: () => boolean;
          cancelGesture?: () => void;
        } | null;
        if (gesture?.isGestureActive?.()) {
          event.preventDefault();
          gesture.cancelGesture?.();
          return;
        }
        // Close an open comment / comparison first, then leave comment mode / clear selection
        if (useVersionStore.getState().compare) {
          useVersionStore.getState().stopCompare();
          return;
        }
        const comments = useCommentsStore.getState();
        if (comments.draft || comments.activeThreadId) {
          comments.cancelDraft();
          comments.openThread(null);
          return;
        }
        useSelectionStore.getState().clearSelection();
        useToolStore.getState().setTool('select');
        return;
      }

      // Delete / Backspace = delete selected (or remove waypoint if moving one)
      if (key === 'delete' || key === 'backspace') {
        const mgr = interactionManagerRef.current as {
          handleKeyDown?: (e: KeyboardEvent) => boolean;
        } | null;
        if (mgr?.handleKeyDown?.(event)) return;
        if (selectedIds.size > 0) {
          event.preventDefault();
          actions.deleteSelection();
        } else if (key === 'backspace' && useDiagramStore.getState().diagramPath.length > 1) {
          event.preventDefault();
          useDiagramStore.getState().navigateUp();
        }
        return;
      }

      // Enter: drill into a selected portal, or edit the selected element's label
      if (key === 'enter' && !mod && selectedIds.size === 1) {
        const [id] = Array.from(selectedIds);
        const el = useElementsStore.getState().elements.get(id);
        if (el && !el.isDeleted) {
          event.preventDefault();
          const controller = getCanvasController();
          if (el.type === 'portal') controller?.openPortal?.(id);
          else controller?.editLabel?.(id);
          return;
        }
      }

      // Alt+Arrow: duplicate the selection next to itself in that direction (Miro)
      if (!mod && event.altKey && NUDGE_KEYS[key] && selectedIds.size > 0) {
        event.preventDefault();
        const [ux, uy] = NUDGE_KEYS[key];
        actions.duplicateBeside({ x: ux as -1 | 0 | 1, y: uy as -1 | 0 | 1 });
        return;
      }

      // Arrow keys nudge the selection (Shift = 10px)
      if (!mod && NUDGE_KEYS[key] && selectedIds.size > 0) {
        event.preventDefault();
        const [ux, uy] = NUDGE_KEYS[key];
        const step = event.shiftKey ? 10 : 1;
        nudgeSelection(ux * step, uy * step);
        return;
      }

      // Mod+K = command palette (jump to anything, run commands)
      if (mod && key === 'k') {
        event.preventDefault();
        useUIStore.getState().setShowCommandPalette(true);
        return;
      }

      // ── Zoom ───────────────────────────────────────────────
      if (event.shiftKey && !mod && code === 'Digit1') {
        event.preventDefault();
        actions.zoomToFit();
        return;
      }
      if (event.shiftKey && !mod && code === 'Digit2') {
        event.preventDefault();
        actions.zoomToSelection();
        return;
      }
      if (mod && (key === '=' || key === '+')) {
        event.preventDefault();
        getCanvasController()?.zoomIn();
        return;
      }
      if (mod && key === '-') {
        event.preventDefault();
        getCanvasController()?.zoomOut();
        return;
      }
      if (mod && key === '0') {
        event.preventDefault();
        getCanvasController()?.resetZoom();
        return;
      }

      // ── History ────────────────────────────────────────────
      if (mod && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        useElementsStore.getState().undo();
        return;
      }
      if ((mod && key === 'z' && event.shiftKey) || (mod && key === 'y')) {
        event.preventDefault();
        useElementsStore.getState().redo();
        return;
      }

      // ── Selection & structure ──────────────────────────────
      if (mod && key === 'a') {
        event.preventDefault();
        actions.selectAll();
        return;
      }
      if (mod && key === 'g') {
        event.preventDefault();
        if (event.shiftKey) actions.ungroup();
        else actions.group();
        return;
      }
      if (mod && key === 'd') {
        event.preventDefault();
        actions.duplicate();
        return;
      }
      if (mod && event.shiftKey && key === 'l') {
        event.preventDefault();
        actions.toggleLock();
        return;
      }

      // ── Stacking: Ctrl+] / Ctrl+[ (with Shift = all the way) ─
      if (mod && (code === 'BracketRight' || code === 'BracketLeft')) {
        event.preventDefault();
        const up = code === 'BracketRight';
        actions.reorder(event.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward');
        return;
      }

      // Shift+Alt+T = tidy up layout
      if (event.shiftKey && event.altKey && code === 'KeyT') {
        event.preventDefault();
        void actions.tidyUp();
        return;
      }

      // Shift+Alt+C = copy as PNG
      if (event.shiftKey && event.altKey && code === 'KeyC') {
        event.preventDefault();
        void actions.copySelectionAsPng();
        return;
      }

      // ── Panels & files ─────────────────────────────────────
      if (mod && event.shiftKey && key === 't') {
        event.preventDefault();
        useUIStore.getState().toggleDiagramTree();
        return;
      }
      if (mod && key === 's' && !event.shiftKey) {
        event.preventDefault();
        useUIStore.getState().toggleVersionHistory();
        return;
      }
      if (mod && event.shiftKey && key === 'e') {
        event.preventDefault();
        useUIStore.getState().toggleExportDialog();
        return;
      }
      if (mod && key === 'o' && !event.shiftKey) {
        event.preventDefault();
        openImportDialog();
        return;
      }

      // Tool shortcuts (only without modifiers)
      if (!mod && !event.altKey && !event.shiftKey) {
        // Q keeps the current drawing tool active after each shape (Excalidraw, tldraw)
        if (key === 'q') {
          useToolStore.getState().toggleToolLock();
          return;
        }
        const tool = KEY_TO_TOOL[key];
        if (tool) useToolStore.getState().setTool(tool);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        interactionManagerRef.current?.setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [interactionManagerRef]);
}

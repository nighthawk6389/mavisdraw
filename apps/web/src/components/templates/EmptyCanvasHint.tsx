import { useState } from 'react';
import { useDiagramStore } from '../../stores/diagramStore';
import { useElementsStore } from '../../stores/elementsStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { useToolStore } from '../../stores/toolStore';
import { useUIStore } from '../../stores/uiStore';
import { useRepoStore } from '../../repo/repoStore';

/**
 * On an empty top-level map, the quickest ways to get something on it: a
 * compact bar near the bottom, out of the way of drawing. It goes away as
 * soon as anything is on the map, a drawing tool is picked, or it's
 * dismissed.
 */
export default function EmptyCanvasHint() {
  const [dismissed, setDismissed] = useState(false);
  const activeDiagramId = useDiagramStore((s) => s.activeDiagramId);
  const isTopLevel = useDiagramStore((s) => s.diagramPath.length <= 1);
  const canEdit = usePermissionStore((s) => s.canEdit);
  const drawing = useToolStore((s) => s.activeTool !== 'select' && s.activeTool !== 'hand');
  // A boolean, not a list: this re-renders only when emptiness flips
  const isEmpty = useElementsStore((s) => {
    for (const el of s.elements.values()) {
      if (el.diagramId === activeDiagramId && !el.isDeleted) return false;
    }
    return true;
  });
  if (dismissed || !isEmpty || !isTopLevel || !canEdit || drawing) return null;

  const action =
    'rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800';
  return (
    // Above the zoom controls (bottom right), so it never covers them
    <div className="pointer-events-none absolute inset-x-0 bottom-14 z-20 flex justify-center px-4">
      <section
        aria-label="Start your map"
        data-testid="empty-canvas-hint"
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white/95 px-3 py-2 text-xs text-gray-600 shadow-lg backdrop-blur"
      >
        <span className="font-semibold text-gray-900">Start your map:</span>
        <button
          type="button"
          className={action}
          onClick={() => useRepoStore.getState().setDialogOpen(true)}
        >
          Map a repository
        </button>
        <button
          type="button"
          className={action}
          onClick={() => useUIStore.getState().setShowTemplateDialog(true)}
        >
          Use a template
        </button>
        <button
          type="button"
          className={action}
          onClick={() => useUIStore.getState().setShowMermaidDialog(true)}
        >
          From Mermaid
        </button>
        <span className="hidden sm:inline">
          or draw: <kbd className="rounded bg-gray-100 px-1">R</kbd> box ·{' '}
          <kbd className="rounded bg-gray-100 px-1">O</kbd> nested system ·{' '}
          <kbd className="rounded bg-gray-100 px-1">A</kbd> arrow
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          className="ml-1 text-gray-400 hover:text-gray-600"
          onClick={() => setDismissed(true)}
        >
          ×
        </button>
      </section>
    </div>
  );
}

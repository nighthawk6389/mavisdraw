import { useEffect, useState, useRef } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { useElementsStore } from '../../stores/elementsStore';
import { toast } from '../../stores/toastStore';
import { findTemplate, TEMPLATES } from '../../templates/templates';
import { activeDiagramIsEmpty, insertTemplate } from '../../templates/startup';
import TemplateCards from './TemplateCards';
import { useModalDialog } from '../ui/useModalDialog';

const close = () => useUIStore.getState().setShowTemplateDialog(false);

/** Right of whatever is already on the diagram, so a template never lands on top of it. */
function freeSpot(): { x: number; y: number } {
  if (activeDiagramIsEmpty()) return { x: 0, y: 0 };
  const diagramId = useDiagramStore.getState().activeDiagramId;
  let maxX = -Infinity;
  let minY = Infinity;
  for (const el of useElementsStore.getState().elements.values()) {
    if (el.diagramId !== diagramId || el.isDeleted) continue;
    maxX = Math.max(maxX, el.x + el.width);
    minY = Math.min(minY, el.y);
  }
  return { x: maxX + 200, y: minY };
}

/** Add a template's map to the diagram on screen (⌘K → Insert a template…). */
export default function TemplateDialog() {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(dialogRef, close);
  const [selected, setSelected] = useState(TEMPLATES[0].id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const insert = async () => {
    const template = findTemplate(selected);
    if (!template || busy) return;
    setBusy(true);
    try {
      const result = await insertTemplate(template, freeSpot());
      toast(
        `Added “${template.name}” (${result.diagrams} nested ${result.diagrams === 1 ? 'diagram' : 'diagrams'})`,
        'success',
        { label: 'Undo', run: () => useElementsStore.getState().undo() },
      );
      close();
    } catch (err) {
      toast(`Couldn't add the template: ${err instanceof Error ? err.message : err}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={close}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Insert a template"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-gray-900">Insert a template</h2>
          <button
            type="button"
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600"
            onClick={close}
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <p className="mb-3 text-sm text-gray-600">
            Each template is a multi-level map: boxes marked ↗ open into their own diagram.
            Everything is editable.
          </p>
          <TemplateCards value={selected} onChange={setSelected} includeBlank={false} />
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={close}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void insert()}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import { usePresentStore } from '../../stores/presentStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { usePermissionStore } from '../../stores/permissionStore';

/** Build and run a presentation path through the map's levels. */
export default function TourPanel() {
  const open = usePresentStore((s) => s.panelOpen);
  const stops = usePresentStore((s) => s.stops);
  const diagrams = useDiagramStore((s) => s.diagrams);
  const canEdit = usePermissionStore((s) => s.canEdit);
  const store = usePresentStore.getState;

  if (!open) return null;

  return (
    <aside
      className="flex w-72 flex-col overflow-hidden border-l bg-white"
      aria-label="Tour"
      data-testid="tour-panel"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">Tour</h3>
        <button
          type="button"
          aria-label="Close tour"
          className="text-sm text-gray-400 hover:text-gray-600"
          onClick={() => store().setPanelOpen(false)}
        >
          &times;
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b bg-gray-50 px-3 py-2">
        <button
          type="button"
          className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={stops.length === 0}
          onClick={() => void store().start(0)}
        >
          ▶ Present
        </button>
        {canEdit && (
          <>
            <button
              type="button"
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
              onClick={() => store().addCurrentView()}
              title="Add what's on screen now as the next stop"
            >
              + Add this view
            </button>
            <button
              type="button"
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
              onClick={() => {
                if (
                  stops.length === 0 ||
                  confirm('Replace the current tour with one stop per level of the map?')
                ) {
                  void store().generate();
                }
              }}
              title="One stop per level, top-down: an instant walkthrough of the architecture"
            >
              Generate from map
            </button>
          </>
        )}
      </div>

      <ol className="flex-1 overflow-y-auto">
        {stops.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-gray-400">
            A tour walks people through the map, level by level. Add views as stops, or generate one
            from the map.
          </li>
        )}
        {stops.map((stop, i) => (
          <li key={stop.id} className="group border-b px-3 py-2" data-testid="tour-stop">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
                {i + 1}
              </span>
              {canEdit ? (
                <input
                  value={stop.title}
                  aria-label={`Stop ${i + 1} title`}
                  onChange={(e) => store().updateStop(stop.id, { title: e.target.value })}
                  className="min-w-0 flex-1 rounded border border-transparent px-1 text-sm font-medium text-gray-800 hover:border-gray-200 focus:border-blue-400 focus:outline-none"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                  {stop.title}
                </span>
              )}
              <button
                type="button"
                className="text-[11px] text-blue-600 opacity-0 hover:underline group-hover:opacity-100 focus:opacity-100"
                onClick={() => void store().start(i)}
              >
                Present from here
              </button>
            </div>
            <div className="mt-1 pl-7 text-[11px] text-gray-400">
              ⧉ {diagrams.get(stop.diagramId)?.title ?? 'Diagram'}
              {stop.viewport ? ' · saved view' : ' · whole level'}
            </div>
            {canEdit ? (
              <textarea
                value={stop.note}
                rows={2}
                placeholder="What to say here…"
                aria-label={`Stop ${i + 1} note`}
                onChange={(e) => store().updateStop(stop.id, { note: e.target.value })}
                className="mt-1 ml-7 block w-[calc(100%-1.75rem)] resize-none rounded border border-gray-200 px-1.5 py-1 text-xs text-gray-600 focus:border-blue-400 focus:outline-none"
              />
            ) : (
              stop.note && <p className="mt-1 pl-7 text-xs text-gray-600">{stop.note}</p>
            )}
            {canEdit && (
              <div className="mt-1 flex gap-2 pl-7 text-[11px] text-gray-400">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={i === 0}
                  className="hover:text-gray-700 disabled:opacity-30"
                  onClick={() => store().moveStop(stop.id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={i === stops.length - 1}
                  className="hover:text-gray-700 disabled:opacity-30"
                  onClick={() => store().moveStop(stop.id, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="hover:text-red-600"
                  onClick={() => store().removeStop(stop.id)}
                >
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}

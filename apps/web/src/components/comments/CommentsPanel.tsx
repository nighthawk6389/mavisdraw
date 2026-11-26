import React, { useMemo, useState } from 'react';
import { useCommentsStore } from '../../stores/commentsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { useToolStore } from '../../stores/toolStore';
import { initials, relativeTime } from './commentUtils';

type Scope = 'level' | 'all';

/**
 * Every comment in the project, on every nested level. Clicking a thread
 * drills to its diagram and opens it.
 */
export default function CommentsPanel() {
  const panelOpen = useCommentsStore((s) => s.panelOpen);
  const threads = useCommentsStore((s) => s.threads);
  const showResolved = useCommentsStore((s) => s.showResolved);
  const activeThreadId = useCommentsStore((s) => s.activeThreadId);
  const diagrams = useDiagramStore((s) => s.diagrams);
  const activeDiagramId = useDiagramStore((s) => s.activeDiagramId);
  const [scope, setScope] = useState<Scope>('all');

  const list = useMemo(
    () =>
      Array.from(threads.values())
        .filter((t) => t.comments.length > 0)
        .filter((t) => showResolved || !t.resolvedAt)
        .filter((t) => scope === 'all' || t.diagramId === activeDiagramId)
        .sort(
          (a, b) =>
            new Date(b.comments[b.comments.length - 1].createdAt).getTime() -
            new Date(a.comments[a.comments.length - 1].createdAt).getTime(),
        ),
    [threads, showResolved, scope, activeDiagramId],
  );

  const openCount = useMemo(
    () => Array.from(threads.values()).filter((t) => !t.resolvedAt).length,
    [threads],
  );

  if (!panelOpen) return null;

  return (
    <aside
      className="flex w-72 flex-col overflow-hidden border-l bg-white"
      aria-label="Comments"
      data-testid="comments-panel"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Comments <span className="font-normal text-gray-400">({openCount} open)</span>
        </h3>
        <button
          type="button"
          aria-label="Close comments"
          className="text-sm text-gray-400 hover:text-gray-600"
          onClick={() => useCommentsStore.getState().setPanelOpen(false)}
        >
          &times;
        </button>
      </div>

      <div className="flex items-center gap-2 border-b bg-gray-50 px-3 py-2 text-xs">
        <div className="flex overflow-hidden rounded border border-gray-300" role="tablist">
          {(['all', 'level'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              className={`px-2 py-0.5 ${scope === s ? 'bg-white font-medium text-gray-900' : 'text-gray-500'}`}
              onClick={() => setScope(s)}
            >
              {s === 'all' ? 'All levels' : 'This level'}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1 text-gray-600">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => useCommentsStore.getState().setShowResolved(e.target.checked)}
          />
          Resolved
        </label>
      </div>

      <ul className="flex-1 overflow-y-auto">
        {list.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-gray-400">
            No comments yet. Press{' '}
            <button
              type="button"
              className="rounded bg-gray-100 px-1 font-mono text-gray-600"
              onClick={() => useToolStore.getState().setTool('comment')}
            >
              C
            </button>{' '}
            and click anywhere to start a thread.
          </li>
        )}
        {list.map((t) => {
          const first = t.comments[0];
          const replies = t.comments.length - 1;
          const where = diagrams.get(t.diagramId)?.title ?? 'Diagram';
          return (
            <li key={t.id}>
              <button
                type="button"
                data-testid="comments-panel-item"
                className={`w-full border-b px-3 py-2 text-left hover:bg-gray-50 ${
                  t.id === activeThreadId ? 'bg-blue-50' : ''
                }`}
                onClick={() => void useCommentsStore.getState().goToThread(t.id)}
              >
                <div className="flex items-center gap-2 text-[11px] text-gray-500">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[9px] font-semibold text-indigo-700">
                    {initials(first.author.name)}
                  </span>
                  <span className="font-medium text-gray-700">{first.author.name}</span>
                  <span>{relativeTime(t.comments[t.comments.length - 1].createdAt)}</span>
                  {t.resolvedAt && (
                    <span className="rounded bg-green-100 px-1 text-[10px] text-green-700">
                      resolved
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-gray-800">{first.body}</p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-400">
                  {(scope === 'all' || t.diagramId !== activeDiagramId) && (
                    <span className="truncate" title={`On ${where}`}>
                      ⧉ {where}
                    </span>
                  )}
                  {replies > 0 && (
                    <span>
                      {replies} {replies === 1 ? 'reply' : 'replies'}
                    </span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

import { useMemo } from 'react';
import type { MavisElement, PortalElement, TextElement } from '@mavisdraw/types';
import { useProposalsStore } from '../../stores/proposalsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { useElementsStore } from '../../stores/elementsStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { useUIStore } from '../../stores/uiStore';
import ProposalChangeList from './ProposalChangeList';
import { timeAgo } from './mcpSetup';

/** Element id → the label people know it by (for "Rename X to Y"). */
function labelsById(elements: Map<string, MavisElement>): Map<string, string> {
  const names = new Map<string, string>();
  for (const el of elements.values()) {
    if (el.isDeleted) continue;
    if (el.type === 'portal') {
      const label = (el as PortalElement).label;
      if (label) names.set(el.id, label);
      continue;
    }
    for (const b of el.boundElements) {
      if (b.type !== 'text') continue;
      const text = (elements.get(b.id) as TextElement | undefined)?.text.trim();
      if (text) names.set(el.id, text);
    }
  }
  return names;
}

/**
 * Map updates coding agents proposed (over MCP), for a person to apply or
 * dismiss. Applying is one undoable step on the proposal's diagram.
 */
export default function ProposalsPanel() {
  const proposals = useProposalsStore((s) => s.proposals);
  const busyId = useProposalsStore((s) => s.busyId);
  const diagrams = useDiagramStore((s) => s.diagrams);
  const elements = useElementsStore((s) => s.elements);
  const canEdit = usePermissionStore((s) => s.canEdit);
  const names = useMemo(() => labelsById(elements), [elements]);

  return (
    <aside
      className="flex w-80 flex-col overflow-hidden border-l bg-white"
      aria-label="Proposed map updates"
      data-testid="proposals-panel"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Proposed updates <span className="font-normal text-gray-400">({proposals.length})</span>
        </h3>
        <button
          type="button"
          aria-label="Close proposals"
          className="text-sm text-gray-400 hover:text-gray-600"
          onClick={() => useProposalsStore.getState().setPanelOpen(false)}
        >
          &times;
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {proposals.length === 0 ? (
          <div className="space-y-3 px-3 py-6 text-center text-sm text-gray-500">
            <p>Nothing waiting for review.</p>
            <p className="text-xs">
              Coding agents connected to MavisDraw propose updates here when their changes alter the
              architecture.
            </p>
            <button
              type="button"
              onClick={() => useUIStore.getState().setShowAgentAccess(true)}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              Connect a coding agent
            </button>
          </div>
        ) : (
          <ul>
            {proposals.map((p) => {
              const diagram = diagrams.get(p.diagramId);
              const busy = busyId === p.id;
              return (
                <li key={p.id} className="border-b px-3 py-3 text-sm" data-testid="proposal">
                  <div className="mb-1 flex items-center gap-1 text-[11px] text-gray-500">
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 font-medium text-violet-800">
                      {p.source === 'pull_request' ? 'Pull request' : 'Agent'}
                    </span>
                    <span className="truncate" title={p.sourceLabel}>
                      {p.sourceLabel}
                    </span>
                    {p.authorName && <span className="shrink-0">· {p.authorName}</span>}
                    <span className="ml-auto shrink-0">{timeAgo(p.createdAt)}</span>
                  </div>
                  <p className="mb-1 font-medium text-gray-800">{p.description}</p>
                  <button
                    type="button"
                    onClick={() => void useProposalsStore.getState().show(p.id)}
                    className="mb-2 text-[11px] text-blue-600 hover:text-blue-800"
                  >
                    On “{diagram?.title ?? 'a diagram'}” — show
                  </button>
                  {p.sourceUrl && (
                    <a
                      href={p.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mb-2 ml-2 text-[11px] text-blue-600 hover:text-blue-800"
                    >
                      View source
                    </a>
                  )}
                  <ProposalChangeList
                    changes={p.changes}
                    connections={p.connections}
                    names={names}
                    className="mb-3 text-xs"
                  />
                  {canEdit ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy || !!busyId}
                        onClick={() => void useProposalsStore.getState().apply(p.id)}
                        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {busy ? 'Working…' : 'Apply'}
                      </button>
                      <button
                        type="button"
                        disabled={!!busyId}
                        onClick={() => void useProposalsStore.getState().dismiss(p.id)}
                        className="rounded bg-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-400">
                      People who can edit the map apply or dismiss proposals.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Diagram, MavisElement, PortalElement, TextElement } from '@mavisdraw/types';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useRepoStore } from '../../repo/repoStore';
import { useUIStore } from '../../stores/uiStore';
import { useProposalsStore } from '../../stores/proposalsStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { loadDiagramElements } from '../../services/diagramSync';
import { getCanvasController } from '../canvas/canvasController';
import * as actions from '../../editor/actions';
import { shortcut } from '../../utils/platform';
import { useThemeStore } from '../../stores/themeStore';
import { useModalDialog } from '../ui/useModalDialog';

interface Result {
  id: string;
  kind: 'element' | 'diagram' | 'command';
  title: string;
  subtitle?: string;
  hint?: string;
  score: number;
  run: () => void | Promise<void>;
}

/** Human label for an element: its own text, its label, or its portal title. */
function labelOf(el: MavisElement, elements: Map<string, MavisElement>): string | null {
  if (el.type === 'portal') return (el as PortalElement).label || null;
  if (el.type === 'text') return (el as TextElement).containerId ? null : (el as TextElement).text;
  for (const b of el.boundElements) {
    if (b.type !== 'text') continue;
    const t = elements.get(b.id) as TextElement | undefined;
    if (t && !t.isDeleted && t.text.trim()) return t.text;
  }
  return null;
}

function pathTitle(diagrams: Map<string, Diagram>, id: string): string {
  const parts: string[] = [];
  let current: Diagram | undefined = diagrams.get(id);
  while (current && parts.length < 20) {
    parts.unshift(current.title);
    current = current.parentDiagramId ? diagrams.get(current.parentDiagramId) : undefined;
  }
  return parts.join(' › ');
}

/** Case-insensitive match; prefix and word-start matches rank higher. */
function score(text: string, query: string): number {
  if (!query) return 1;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = t.indexOf(q);
  if (idx < 0) return 0;
  if (idx === 0) return 3;
  if (/\W/.test(t[idx - 1])) return 2;
  return 1;
}

async function goToDiagram(diagramId: string): Promise<void> {
  useSelectionStore.getState().clearSelection();
  useDiagramStore.getState().navigateToDiagram(diagramId);
  await loadDiagramElements(diagramId).catch(() => undefined);
  getCanvasController()?.zoomToFit();
}

async function goToElement(el: MavisElement): Promise<void> {
  if (useDiagramStore.getState().activeDiagramId !== el.diagramId) {
    useDiagramStore.getState().navigateToDiagram(el.diagramId);
  }
  // Labels are found by text, but the shape is what gets selected
  let target = el;
  if (el.type === 'text' && el.containerId) {
    target = useElementsStore.getState().elements.get(el.containerId) ?? el;
  }
  useSelectionStore.getState().select(target.id);
  // Let the canvas pick up the new diagram before zooming
  await new Promise((r) => requestAnimationFrame(r));
  getCanvasController()?.zoomToSelection();
}

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(dialogRef, onClose);
  const listRef = useRef<HTMLUListElement>(null);
  const elements = useElementsStore((s) => s.elements);
  const diagrams = useDiagramStore((s) => s.diagrams);

  // Search the whole hierarchy: load diagrams that haven't been opened yet
  useEffect(() => {
    inputRef.current?.focus();
    for (const id of useDiagramStore.getState().diagrams.keys()) {
      loadDiagramElements(id).catch(() => undefined);
    }
  }, []);

  const commands = useMemo<Omit<Result, 'score'>[]>(
    () => [
      {
        id: 'cmd-fit',
        kind: 'command',
        title: 'Zoom to fit',
        hint: shortcut('Shift+1'),
        run: actions.zoomToFit,
      },
      {
        id: 'cmd-tidy',
        kind: 'command',
        title: 'Tidy up layout',
        hint: shortcut('Shift+Alt+T'),
        run: actions.tidyUp,
      },
      {
        id: 'cmd-mermaid',
        kind: 'command',
        title: 'Import from Mermaid…',
        subtitle: 'Paste a flowchart; subgraphs become nested diagrams',
        run: () => useUIStore.getState().setShowMermaidDialog(true),
      },
      {
        id: 'cmd-repo',
        kind: 'command',
        title: 'Map a repository…',
        subtitle: 'Generate the architecture from code, or check the map against it',
        run: () => useRepoStore.getState().setDialogOpen(true),
      },
      {
        id: 'cmd-template',
        kind: 'command',
        title: 'Insert a template…',
        subtitle: 'C4, microservices, AWS, event-driven, data pipeline, SaaS — as nested maps',
        run: () => useUIStore.getState().setShowTemplateDialog(true),
      },
      {
        id: 'cmd-agent',
        kind: 'command',
        title: 'Connect a coding agent…',
        subtitle: 'Let Claude Code, Cursor and others read the map and propose updates (MCP)',
        run: () => useUIStore.getState().setShowAgentAccess(true),
      },
      {
        id: 'cmd-proposals',
        kind: 'command',
        title: 'Proposed map updates',
        subtitle: 'Review what coding agents proposed',
        run: () => useProposalsStore.getState().setPanelOpen(true),
      },
      {
        id: 'cmd-export',
        kind: 'command',
        title: 'Export…',
        hint: shortcut('Mod+Shift+E'),
        run: () => useUIStore.getState().toggleExportDialog(),
      },
      {
        id: 'cmd-sketchy',
        kind: 'command',
        title: 'Toggle hand-drawn style',
        run: () => {
          const ui = useUIStore.getState();
          ui.setRenderMode(ui.renderMode === 'sketchy' ? 'clean' : 'sketchy');
        },
      },
      {
        id: 'cmd-theme',
        kind: 'command',
        title: 'Toggle dark mode',
        hint: shortcut('Shift+Alt+D'),
        run: () => useThemeStore.getState().toggle(),
      },
      {
        id: 'cmd-minimap',
        kind: 'command',
        title: 'Toggle overview map',
        hint: 'M',
        run: () => useUIStore.getState().toggleMinimap(),
      },
      {
        id: 'cmd-grid',
        kind: 'command',
        title: 'Toggle grid',
        run: () => useUIStore.getState().toggleGrid(),
      },
      {
        id: 'cmd-snap-grid',
        kind: 'command',
        title: 'Toggle snap to grid',
        run: () => useUIStore.getState().toggleSnapToGrid(),
      },
      {
        id: 'cmd-snap-objects',
        kind: 'command',
        title: 'Toggle snap to shapes (smart guides)',
        run: () => useUIStore.getState().toggleSnapToObjects(),
      },
      {
        id: 'cmd-history',
        kind: 'command',
        title: 'Version history',
        run: () => useUIStore.getState().toggleVersionHistory(),
      },
      {
        id: 'cmd-copy-png',
        kind: 'command',
        title: 'Copy as PNG',
        hint: shortcut('Shift+Alt+C'),
        run: () => void actions.copySelectionAsPng(),
      },
    ],
    [],
  );

  const results = useMemo<Result[]>(() => {
    const q = query.trim();
    const out: Result[] = [];

    for (const d of diagrams.values()) {
      const s = score(d.title, q);
      if (s > 0) {
        out.push({
          id: `d-${d.id}`,
          kind: 'diagram',
          title: d.title,
          subtitle: pathTitle(diagrams, d.id),
          score: s + 0.5,
          run: () => goToDiagram(d.id),
        });
      }
    }

    if (q) {
      for (const el of elements.values()) {
        if (el.isDeleted || el.type === 'portal') continue;
        const label = labelOf(el, elements);
        if (!label) continue;
        const s = score(label, q);
        if (s > 0) {
          out.push({
            id: `e-${el.id}`,
            kind: 'element',
            title: label.replace(/\s+/g, ' '),
            subtitle: pathTitle(diagrams, el.diagramId),
            score: s,
            run: () => goToElement(el),
          });
        }
      }
    }

    const editable = usePermissionStore.getState().canEdit;
    for (const c of commands) {
      if (!editable && (c.id === 'cmd-tidy' || c.id === 'cmd-mermaid' || c.id === 'cmd-repo'))
        continue;
      const s = score(c.title, q);
      if (s > 0) out.push({ ...c, score: q ? s - 0.25 : 0 });
    }

    return out.sort((a, b) => b.score - a.score).slice(0, 50);
  }, [query, elements, diagrams, commands]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (result: Result | undefined) => {
    if (!result) return;
    onClose();
    void result.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const kindLabel = { element: 'Shape', diagram: 'Diagram', command: 'Command' } as const;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/20 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-[560px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
      >
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
          aria-label="Search shapes, diagrams and commands"
          placeholder="Jump to a shape or diagram, or run a command…"
          className="w-full border-b border-gray-100 px-4 py-3 text-base outline-none"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul
          id="command-results"
          role="listbox"
          ref={listRef}
          className="max-h-[50vh] overflow-y-auto py-1"
        >
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-gray-400">No matches</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`cmd-${r.id}`}
              role="option"
              aria-selected={i === active}
              data-index={i}
              className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm ${
                i === active ? 'bg-blue-50' : ''
              }`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
            >
              <span className="w-16 shrink-0 text-xs uppercase tracking-wide text-gray-400">
                {kindLabel[r.kind]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-gray-900">{r.title}</span>
                {r.subtitle && (
                  <span className="block truncate text-xs text-gray-500">{r.subtitle}</span>
                )}
              </span>
              {r.hint && <span className="text-xs text-gray-400">{r.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

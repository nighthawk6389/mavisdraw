import React, { useEffect } from 'react';
import { useVersionStore } from '../../stores/versionStore';
import { useViewportStore } from '../../stores/viewportStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { highlightBounds, summarize, type ChangeKind } from '../../versions/diff';
import { useCompareDiff } from './useCompareDiff';

const COLORS: Record<ChangeKind, string> = {
  added: '#2f9e44',
  changed: '#f08c00',
  removed: '#e03131',
};

/**
 * Comparing with a version: outlines what was added (green) and changed
 * (amber) on the canvas, and draws what was removed as red dashed ghosts.
 */
export default function DiffOverlay() {
  const compare = useVersionStore((s) => s.compare);
  const diagramId = useDiagramStore((s) => s.activeDiagramId);
  const zoom = useViewportStore((s) => s.zoom);
  const scrollX = useViewportStore((s) => s.scrollX);
  const scrollY = useViewportStore((s) => s.scrollY);
  const diff = useCompareDiff();

  // Comparing is about one diagram: leaving it ends the comparison
  useEffect(() => {
    const c = useVersionStore.getState().compare;
    if (c && c.diagramId !== diagramId) useVersionStore.getState().stopCompare();
  }, [diagramId]);

  if (!compare || !diff) return null;
  const pad = 6 / zoom;

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 z-10 h-full w-full"
        data-testid="diff-overlay"
        aria-hidden
      >
        <g transform={`translate(${scrollX} ${scrollY}) scale(${zoom})`}>
          {diff.changes.map((c) => {
            const b = highlightBounds(c.element);
            const color = COLORS[c.kind];
            return (
              <g key={`${c.kind}-${c.id}`} data-kind={c.kind}>
                <rect
                  x={b.x - pad}
                  y={b.y - pad}
                  width={b.width + pad * 2}
                  height={b.height + pad * 2}
                  rx={6 / zoom}
                  fill={c.kind === 'removed' ? 'rgba(224,49,49,0.06)' : 'none'}
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray={c.kind === 'removed' ? '6 4' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
                {c.kind === 'removed' && (
                  <text
                    x={b.x + b.width / 2}
                    y={b.y + b.height / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={13 / zoom}
                    fill={color}
                    fontFamily="system-ui, sans-serif"
                  >
                    {c.name}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div
        className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-gray-200 bg-white/95 px-4 py-1.5 text-xs shadow-md backdrop-blur"
        role="status"
        data-testid="diff-banner"
      >
        <span className="text-gray-600">
          Changes since <span className="font-semibold text-gray-900">{compare.title}</span>
        </span>
        <span className="flex items-center gap-2 font-medium">
          <Legend color={COLORS.added} label={`${diff.added} added`} />
          <Legend color={COLORS.changed} label={`${diff.changed} changed`} />
          <Legend color={COLORS.removed} label={`${diff.removed} removed`} />
        </span>
        {diff.changes.length === 0 && <span className="text-gray-500">{summarize(diff)}</span>}
        <button
          type="button"
          className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700 hover:bg-gray-200"
          onClick={() => useVersionStore.getState().stopCompare()}
        >
          Done
        </button>
      </div>
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-gray-700">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

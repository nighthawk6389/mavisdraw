import React, { useEffect } from 'react';
import { usePresentStore } from '../../stores/presentStore';

/**
 * Full-screen presentation: the editor's chrome is hidden (see App), the
 * canvas can't be edited, and a card shows where we are. Arrow keys / Space
 * / click move between stops; Escape ends (or stops following).
 */
export default function PresentationOverlay() {
  const presenting = usePresentStore((s) => s.presenting);
  const following = usePresentStore((s) => s.following);
  const remote = usePresentStore((s) => s.remote);
  const stops = usePresentStore((s) => s.stops);
  const index = usePresentStore((s) => s.index);
  const active = presenting || following;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const s = usePresentStore.getState();
      const nextKeys = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
      const prevKeys = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];
      let handled = true;
      if (e.key === 'Escape') {
        if (s.presenting) s.end();
        else s.unfollow();
      } else if (s.presenting && nextKeys.includes(e.key)) void s.next();
      else if (s.presenting && prevKeys.includes(e.key)) void s.prev();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    // Capture: the editor's own shortcuts must not run while presenting
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  if (!active) return null;
  const stop = stops[index];

  return (
    <div className="absolute inset-0 z-40" data-testid="presentation">
      {/* Clicks advance the presenter's slides and never reach the canvas */}
      <div
        className="absolute inset-0"
        onClick={() => presenting && void usePresentStore.getState().next()}
        onWheel={(e) => e.stopPropagation()}
      />
      <div className="pointer-events-auto absolute bottom-6 left-1/2 w-[min(640px,calc(100%-32px))] -translate-x-1/2 rounded-xl border border-gray-200 bg-white/95 px-5 py-3 shadow-xl backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              {following && remote ? `Following ${remote.presenterName} · ` : ''}
              Stop {index + 1} of {stops.length}
            </div>
            <h2
              className="truncate text-lg font-semibold text-gray-900"
              data-testid="presentation-title"
            >
              {stop?.title}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {presenting && (
              <>
                <button
                  type="button"
                  aria-label="Previous stop"
                  disabled={index === 0}
                  className="rounded-full px-2 py-1 text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                  onClick={() => void usePresentStore.getState().prev()}
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Next stop"
                  disabled={index >= stops.length - 1}
                  className="rounded-full px-2 py-1 text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                  onClick={() => void usePresentStore.getState().next()}
                >
                  ›
                </button>
              </>
            )}
            <button
              type="button"
              className="ml-2 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700 hover:bg-gray-200"
              onClick={() =>
                presenting
                  ? usePresentStore.getState().end()
                  : usePresentStore.getState().unfollow()
              }
            >
              {presenting ? 'End (Esc)' : 'Stop following'}
            </button>
          </div>
        </div>
        {stop?.note && (
          <p
            className="mt-1 whitespace-pre-wrap text-sm text-gray-600"
            data-testid="presentation-note"
          >
            {stop.note}
          </p>
        )}
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${((index + 1) / Math.max(1, stops.length)) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

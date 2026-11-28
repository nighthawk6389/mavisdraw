import React from 'react';
import { useViewportStore } from '../../stores/viewportStore';
import { useUIStore } from '../../stores/uiStore';
import { getCanvasController } from './canvasController';
import { shortcut } from '../../utils/platform';

const buttonClass =
  'flex h-8 min-w-8 items-center justify-center px-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

/** Bottom-right zoom readout and controls, always visible on the canvas. */
export default function ZoomControls() {
  const zoom = useViewportStore((s) => s.zoom);
  const percent = Math.round(zoom * 100);
  const showMinimap = useUIStore((s) => s.showMinimap);

  return (
    <div
      className="absolute bottom-3 right-3 z-20 flex items-center overflow-hidden rounded-lg border border-gray-200 bg-white/95 text-sm shadow-sm backdrop-blur"
      data-testid="zoom-controls"
    >
      <button
        type="button"
        className={buttonClass}
        aria-label="Zoom out"
        title={`Zoom out (${shortcut('Mod+-')})`}
        onClick={() => getCanvasController()?.zoomOut()}
      >
        −
      </button>
      <button
        type="button"
        className={`${buttonClass} w-14 tabular-nums`}
        aria-label={`Zoom ${percent}%, reset to 100%`}
        title={`Reset to 100% (${shortcut('Mod+0')})`}
        data-testid="zoom-level"
        onClick={() => getCanvasController()?.resetZoom()}
      >
        {percent}%
      </button>
      <button
        type="button"
        className={buttonClass}
        aria-label="Zoom in"
        title={`Zoom in (${shortcut('Mod+=')})`}
        onClick={() => getCanvasController()?.zoomIn()}
      >
        +
      </button>
      <div className="h-5 w-px bg-gray-200" aria-hidden="true" />
      <button
        type="button"
        className={`${buttonClass} ${showMinimap ? 'text-blue-600' : ''}`}
        aria-label="Overview map"
        aria-pressed={showMinimap}
        title="Overview map (M)"
        data-testid="minimap-toggle"
        onClick={() => useUIStore.getState().toggleMinimap()}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <rect x="4" y="5" width="5" height="4" rx="0.5" fill="currentColor" opacity="0.6" />
        </svg>
      </button>
      <button
        type="button"
        className={buttonClass}
        aria-label="Zoom to fit"
        title={`Zoom to fit (${shortcut('Shift+1')})`}
        onClick={() => getCanvasController()?.zoomToFit()}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

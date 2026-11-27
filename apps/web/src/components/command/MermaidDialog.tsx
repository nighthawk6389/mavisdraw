import React, { useEffect, useRef, useState } from 'react';
import { importMermaidText } from '../../import/diagramAsCode';
import { getCanvasController } from '../canvas/canvasController';

const EXAMPLE = `flowchart LR
  user((Customer)) -->|HTTPS| web[Web App]
  web --> api
  subgraph backend [Checkout Backend]
    api[API Gateway] -->|gRPC| orders[Orders Service]
    orders --> db[(Orders DB)]
    orders -. publishes .-> bus[[Event Bus]]
  end`;

/** Paste a Mermaid flowchart; subgraphs become portals into nested diagrams. */
export default function MermaidDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => areaRef.current?.focus(), []);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const at = getCanvasController()?.getPasteAnchor() ?? { x: 0, y: 0 };
    const ok = await importMermaidText(text, at);
    setBusy(false);
    if (ok) {
      onClose();
      getCanvasController()?.zoomToSelection();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mermaid-dialog-title"
        className="w-[640px] max-w-[calc(100vw-32px)] rounded-xl bg-white p-5 shadow-2xl"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
        }}
      >
        <h2 id="mermaid-dialog-title" className="text-base font-semibold text-gray-900">
          Import from Mermaid
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Paste a flowchart from a README or doc. Each <code className="text-gray-700">subgraph</code>{' '}
          becomes a portal you can double-click into. Tip: you can also paste Mermaid straight onto the
          canvas.
        </p>
        <textarea
          ref={areaRef}
          aria-label="Mermaid flowchart"
          className="mt-3 h-64 w-full resize-y rounded-md border border-gray-300 p-3 font-mono text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          placeholder={EXAMPLE}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            className="text-sm text-blue-600 hover:text-blue-800"
            onClick={() => setText(EXAMPLE)}
          >
            Use an example
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !text.trim()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={() => void submit()}
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

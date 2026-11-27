import React from 'react';
import { useToastStore } from '../../stores/toastStore';

const KIND_STYLES = {
  info: 'border-gray-200 bg-white text-gray-800',
  success: 'border-green-200 bg-white text-gray-800',
  error: 'border-red-200 bg-red-50 text-red-800',
} as const;

/** Bottom-center notifications; announced to screen readers. */
export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid="toast"
          className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${KIND_STYLES[t.kind]}`}
        >
          {t.kind === 'success' && <span className="text-green-600" aria-hidden="true">✓</span>}
          <span className="whitespace-pre-line">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="font-medium text-blue-600 hover:text-blue-800"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            className="text-gray-400 hover:text-gray-600"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

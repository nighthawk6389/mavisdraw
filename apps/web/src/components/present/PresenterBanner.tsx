import React from 'react';
import { usePresentStore } from '../../stores/presentStore';

/** "Olivia is presenting · Follow" for everyone else on the project. */
export default function PresenterBanner() {
  const remote = usePresentStore((s) => s.remote);
  const following = usePresentStore((s) => s.following);
  const presenting = usePresentStore((s) => s.presenting);
  if (!remote || following || presenting) return null;
  return (
    <div
      className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5 text-xs text-blue-900 shadow-md"
      role="status"
      data-testid="presenter-banner"
    >
      <span>
        <span className="font-semibold">{remote.presenterName}</span> is presenting
      </span>
      <button
        type="button"
        className="rounded-full bg-blue-600 px-3 py-0.5 font-medium text-white hover:bg-blue-700"
        onClick={() => void usePresentStore.getState().follow()}
      >
        Follow
      </button>
    </div>
  );
}

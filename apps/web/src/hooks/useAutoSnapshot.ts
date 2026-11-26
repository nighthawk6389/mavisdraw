import { useEffect, useRef } from 'react';
import { useElementsStore } from '../stores/elementsStore';
import { useVersionStore } from '../stores/versionStore';
import { canEdit } from '../stores/permissionStore';

const AUTO_SNAPSHOT_DEBOUNCE_MS = 30_000;
const MIN_LOCAL_STEPS = 5;

/**
 * Take an automatic, shared version after a burst of edits (5+ undo steps,
 * then 30s of quiet). Only the local user's own edits count, so a room full
 * of collaborators doesn't produce one snapshot per person for the same work.
 */
export function useAutoSnapshot(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepsRef = useRef(0);

  useEffect(() => {
    const unsubscribe = useElementsStore.subscribe((state, prev) => {
      // New local undo steps are the signal of local editing
      if (state.history === prev.history || state.history.length <= prev.history.length) return;
      if (!canEdit()) return;
      stepsRef.current += state.history.length - prev.history.length;
      if (stepsRef.current < MIN_LOCAL_STEPS) return;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        stepsRef.current = 0;
        void useVersionStore.getState().autoSnapshot();
      }, AUTO_SNAPSHOT_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}

import { useEffect, useRef } from 'react';
import { useElementsStore } from '../stores/elementsStore';
import { useVersionStore } from '../stores/versionStore';
import { canEdit } from '../stores/permissionStore';
import { useDiagramStore } from '../stores/diagramStore';

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
    let diagramId = useDiagramStore.getState().activeDiagramId;
    const unsubscribe = useElementsStore.subscribe((state, prev) => {
      // A new local undo step is the signal of local editing (compare the
      // newest entry, not the length: the history is capped at 100)
      if (state.history === prev.history) return;
      const newest = state.history[state.history.length - 1];
      if (!newest || newest === prev.history[prev.history.length - 1]) return;
      if (!canEdit()) return;
      stepsRef.current += 1;
      if (stepsRef.current < MIN_LOCAL_STEPS) return;

      // Snapshot the diagram that was edited, even if you've moved on since
      diagramId = useDiagramStore.getState().activeDiagramId;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        stepsRef.current = 0;
        void useVersionStore.getState().autoSnapshot(diagramId);
      }, AUTO_SNAPSHOT_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}

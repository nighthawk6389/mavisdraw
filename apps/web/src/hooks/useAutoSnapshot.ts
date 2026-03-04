import { useEffect, useRef } from 'react';
import { useElementsStore } from '../stores/elementsStore';
import { useVersionStore } from '../stores/versionStore';

const AUTO_SNAPSHOT_DEBOUNCE_MS = 30_000; // 30 seconds
const MIN_VERSION_BUMPS = 5;

/**
 * Hook that auto-saves version snapshots on significant changes.
 * Uses a debounce timer: after changes, wait 30s of inactivity before snapshotting.
 * "Significant" = at least 5 cumulative version bumps since last snapshot.
 */
export function useAutoSnapshot(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVersionSumRef = useRef(0);
  const autoSnapshot = useVersionStore((s) => s.autoSnapshot);

  useEffect(() => {
    const unsubscribe = useElementsStore.subscribe((state) => {
      // Compute total version sum across all elements
      let versionSum = 0;
      for (const el of state.elements.values()) {
        versionSum += el.version;
      }

      const diff = versionSum - lastVersionSumRef.current;
      if (diff < MIN_VERSION_BUMPS) return;

      // Reset debounce timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        lastVersionSumRef.current = versionSum;
        autoSnapshot();
      }, AUTO_SNAPSHOT_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [autoSnapshot]);
}

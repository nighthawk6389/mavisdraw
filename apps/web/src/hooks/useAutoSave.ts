import { useEffect, useRef, useCallback, useState } from 'react';
import type { Diagram, MavisElement } from '@mavisdraw/types';
import { findDirtyDiagrams, recordSaved } from '../services/saveTracker';
import { useElementsStore } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';
import { useAuthStore } from '../stores/authStore';
import { ApiError, apiUpdateDiagram, apiSaveDiagram } from '../services/api';
import { ensureDiagramOnServer } from '../services/diagramSync';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 1500;

async function saveDiagram(diagram: Diagram, elements: MavisElement[]): Promise<void> {
  const body = {
    elements,
    title: diagram.title,
    viewBackgroundColor: diagram.viewBackgroundColor,
    gridEnabled: diagram.gridEnabled,
    gridSize: diagram.gridSize,
    renderMode: diagram.renderMode,
    layers: diagram.layers,
  };
  try {
    await apiUpdateDiagram(diagram.id, body);
  } catch (err) {
    // A nested diagram that never reached the server: create it, then save
    if (err instanceof ApiError && err.statusCode === 404) {
      await ensureDiagramOnServer(diagram);
      await apiUpdateDiagram(diagram.id, body);
    } else {
      throw err;
    }
  }
  recordSaved(diagram.id, elements, diagram.updatedAt);
}

/**
 * Debounced autosave of every diagram with unsaved changes (not just the one
 * on screen, so navigating away mid-debounce never loses work).
 */
export function useAutoSave(activeDiagramId: string | null) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const elements = useElementsStore((s) => s.elements);
  const diagrams = useDiagramStore((s) => s.diagrams);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const againRef = useRef(false);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveDirty = useCallback(async (): Promise<void> => {
    if (!useAuthStore.getState().isAuthenticated) return;
    if (savingRef.current) {
      againRef.current = true;
      return savingRef.current;
    }

    const run = async () => {
      do {
        againRef.current = false;
        const dirty = findDirtyDiagrams(
          useElementsStore.getState().elements,
          useDiagramStore.getState().diagrams,
        );
        if (dirty.length === 0) return;

        setSaveStatus('saving');
        try {
          // Parents before children so server-side parent checks pass
          dirty.sort((a, b) => depth(a.diagram) - depth(b.diagram));
          for (const { diagram, elements: els } of dirty) {
            await saveDiagram(diagram, els);
          }
          setSaveStatus('saved');
          if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
          statusTimerRef.current = setTimeout(
            () => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)),
            3000,
          );
        } catch (err) {
          console.error('Auto-save failed:', err);
          setSaveStatus('error');
          return;
        }
      } while (againRef.current);
    };

    savingRef.current = run().finally(() => {
      savingRef.current = null;
    });
    return savingRef.current;
  }, []);

  // Debounce after any change to elements or diagram metadata
  useEffect(() => {
    if (!isAuthenticated) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void saveDirty(), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [elements, diagrams, isAuthenticated, saveDirty]);

  // Don't lose the last edits when the tab is hidden or closed
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden') void saveDirty();
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
      // Leaving the editor (back to dashboard): save whatever is pending
      void saveDirty();
    };
  }, [saveDirty]);

  const manualSave = useCallback(async () => {
    if (!activeDiagramId || !isAuthenticated) return;
    await saveDirty();
    try {
      await apiSaveDiagram(activeDiagramId, 'manual');
    } catch (err) {
      console.error('Manual save snapshot failed:', err);
    }
  }, [activeDiagramId, isAuthenticated, saveDirty]);

  return { saveStatus, manualSave, saveNow: saveDirty };
}

function depth(diagram: Diagram): number {
  const diagrams = useDiagramStore.getState().diagrams;
  let d = 0;
  let current: Diagram | undefined = diagram;
  while (current?.parentDiagramId && d < 50) {
    current = diagrams.get(current.parentDiagramId);
    d++;
  }
  return d;
}

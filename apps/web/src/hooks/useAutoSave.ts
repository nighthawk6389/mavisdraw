import { useEffect, useRef, useCallback, useState } from 'react';
import { useElementsStore } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';
import { useAuthStore } from '../stores/authStore';
import { apiUpdateDiagram, apiSaveDiagram } from '../services/api';
import type { MavisElement } from '@mavisdraw/types';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 2000;

export function useAutoSave(diagramId: string | null) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const elements = useElementsStore((s) => s.elements);
  const diagrams = useDiagramStore((s) => s.diagrams);

  const lastSavedRef = useRef<string>('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);

  const save = useCallback(async () => {
    if (!diagramId || !isAuthenticated || isSavingRef.current) return;

    const diagram = diagrams.get(diagramId);
    if (!diagram) return;

    // Collect elements for this diagram
    const diagramElements: MavisElement[] = [];
    for (const el of elements.values()) {
      if (el.diagramId === diagramId && !el.isDeleted) {
        diagramElements.push(el);
      }
    }

    // Check if anything changed
    const currentHash = JSON.stringify(diagramElements);
    if (currentHash === lastSavedRef.current) return;

    isSavingRef.current = true;
    setSaveStatus('saving');

    try {
      await apiUpdateDiagram(diagramId, {
        elements: diagramElements,
        title: diagram.title,
        viewBackgroundColor: diagram.viewBackgroundColor,
        gridEnabled: diagram.gridEnabled,
        gridSize: diagram.gridSize,
        renderMode: diagram.renderMode,
        layers: diagram.layers,
      });

      lastSavedRef.current = currentHash;
      setSaveStatus('saved');

      // Reset status after 3 seconds
      setTimeout(() => {
        setSaveStatus((s) => (s === 'saved' ? 'idle' : s));
      }, 3000);
    } catch (err) {
      console.error('Auto-save failed:', err);
      setSaveStatus('error');
    } finally {
      isSavingRef.current = false;
    }
  }, [diagramId, isAuthenticated, elements, diagrams]);

  // Debounced auto-save when elements or diagram state changes
  useEffect(() => {
    if (!diagramId || !isAuthenticated) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      save();
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [save, diagramId, isAuthenticated]);

  // Manual save
  const manualSave = useCallback(async () => {
    if (!diagramId || !isAuthenticated) return;
    await save();
    try {
      await apiSaveDiagram(diagramId, 'manual');
    } catch (err) {
      console.error('Manual save snapshot failed:', err);
    }
  }, [diagramId, isAuthenticated, save]);

  return { saveStatus, manualSave };
}

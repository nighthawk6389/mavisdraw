import { useEffect, useRef, useCallback, useState } from 'react';
import type { Diagram, MavisElement } from '@mavisdraw/types';
import {
  findDirtyDiagrams,
  isMetaDirty,
  recordSaved,
  registerSaveFlusher,
  savedVersions,
} from '../services/saveTracker';
import { toast } from '../stores/toastStore';
import { acknowledge } from '../services/offlineJournal';
import { isLiveSynced } from '../stores/collaborationStore';
import { useElementsStore, applyRemoteChanges } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';
import { useAuthStore } from '../stores/authStore';
import { ApiError, apiUpdateDiagram, apiSaveDiagram } from '../services/api';
import { ensureDiagramOnServer } from '../services/diagramSync';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 1500;

/** Save one diagram (exported for tests). */
export async function saveDiagram(diagram: Diagram, elements: MavisElement[]): Promise<void> {
  // A live collaboration room persists the elements itself (and merges
  // everyone's edits); writing them over REST too would just race it.
  if (isLiveSynced(diagram.id)) {
    if (isMetaDirty(diagram)) {
      await apiUpdateDiagram(diagram.id, {
        title: diagram.title,
        viewBackgroundColor: diagram.viewBackgroundColor,
        gridEnabled: diagram.gridEnabled,
        gridSize: diagram.gridSize,
        renderMode: diagram.renderMode,
        layers: diagram.layers,
      });
    }
    recordSaved(diagram.id, elements, diagram.updatedAt);
    return;
  }

  // Every element write is checked against the version this tab last got
  // from the server, so an old copy can never overwrite a teammate's newer
  // edit (and deletes are sent explicitly rather than implied by absence)
  const base = savedVersions(diagram.id);
  const liveIds = new Set(elements.map((el) => el.id));
  const body = {
    elements,
    baseVersions: base ? Object.fromEntries(base) : {},
    deletedIds: base ? Array.from(base.keys()).filter((id) => !liveIds.has(id)) : [],
    title: diagram.title,
    viewBackgroundColor: diagram.viewBackgroundColor,
    gridEnabled: diagram.gridEnabled,
    gridSize: diagram.gridSize,
    renderMode: diagram.renderMode,
    layers: diagram.layers,
  };
  let response;
  try {
    response = await apiUpdateDiagram(diagram.id, body);
  } catch (err) {
    // A nested diagram that never reached the server: create it, then save
    if (err instanceof ApiError && err.statusCode === 404) {
      await ensureDiagramOnServer(diagram);
      response = await apiUpdateDiagram(diagram.id, body);
    } else {
      throw err;
    }
  }
  const serverElements = (response.diagram?.elements ?? elements) as MavisElement[];
  const conflicts = response.conflicts ?? [];
  if (conflicts.length > 0) adoptServerVersions(conflicts, serverElements);
  // The next save is checked against this base, so the base must describe
  // exactly what this tab holds: take in everything the server has that this
  // tab hasn't touched since sending (a teammate's edits and new shapes),
  // and for anything edited while the save was in flight, the version that
  // edit builds on
  const nextBase = adoptServerState(diagram.id, elements, serverElements, base, conflicts);
  recordSaved(diagram.id, nextBase, diagram.updatedAt);
  acknowledge(diagram.id, serverElements);
}

/**
 * After a REST save: bring the store in line with the server's merged copy
 * of the diagram, and return the element list to record as the base for the
 * next save. Exported for tests.
 */
export function adoptServerState(
  diagramId: string,
  sent: MavisElement[],
  server: MavisElement[],
  previousBase: ReadonlyMap<string, number> | undefined,
  conflicts: readonly string[] = [],
): MavisElement[] {
  const conflicted = new Set(conflicts);
  const sentById = new Map(sent.map((el) => [el.id, el]));
  const base: MavisElement[] = [];
  const adopt: MavisElement[] = [];
  const store = useElementsStore.getState().elements;
  for (const theirs of server) {
    if (theirs.diagramId !== diagramId) continue;
    const mine = store.get(theirs.id);
    const sentCopy = sentById.get(theirs.id);
    // (or the store already holds the server's copy: a conflict just adopted it)
    const untouched =
      mine === theirs || (mine === undefined ? sentCopy === undefined : mine === sentCopy);
    if (untouched) {
      // A teammate's new shape, or our own write as the server merged it
      if (mine !== theirs) adopt.push(theirs);
      base.push(theirs);
    } else {
      // Edited here mid-save. If the server took this tab's write as sent, the
      // new edit builds on it. Otherwise the next save goes out against what
      // this edit was based on, so a teammate's change in between is caught
      // as a conflict
      const tookOurs =
        sentCopy !== undefined && !conflicted.has(theirs.id) && sentCopy.version === theirs.version;
      const before = tookOurs ? theirs.version : previousBase?.get(theirs.id);
      if (before !== undefined) base.push({ ...theirs, version: before } as MavisElement);
    }
  }
  if (adopt.length > 0) {
    applyRemoteChanges(() =>
      useElementsStore.setState((prev) => {
        const next = new Map(prev.elements);
        for (const el of adopt) next.set(el.id, el);
        return { elements: next };
      }),
    );
  }
  return base;
}

/**
 * Someone changed these elements after this tab's copy: keep their version
 * (shown immediately) and say so, rather than silently losing either side.
 */
function adoptServerVersions(ids: string[], serverElements: MavisElement[]): void {
  const byId = new Map(serverElements.map((el) => [el.id, el]));
  applyRemoteChanges(() =>
    useElementsStore.setState((prev) => {
      const next = new Map(prev.elements);
      for (const id of ids) {
        const theirs = byId.get(id);
        const mine = next.get(id);
        if (theirs) next.set(id, theirs);
        else if (mine) next.set(id, { ...mine, isDeleted: true } as MavisElement);
      }
      return { elements: next };
    }),
  );
  toast(
    ids.length === 1
      ? 'A teammate changed a shape you also edited — kept their newer version.'
      : `Teammates changed ${ids.length} shapes you also edited — kept their newer versions.`,
    'info',
  );
}

/**
 * Debounced autosave of every diagram with unsaved changes (not just the one
 * on screen, so navigating away mid-debounce never loses work).
 */
export function useAutoSave(activeDiagramId: string | null) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

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
        // Parents before children so server-side parent checks pass. Each
        // diagram on its own: one that can't be saved (too large, gone, no
        // longer ours) mustn't keep every other level's edits from saving
        dirty.sort((a, b) => depth(a.diagram) - depth(b.diagram));
        let failed = false;
        for (const { diagram, elements: els } of dirty) {
          try {
            await saveDiagram(diagram, els);
          } catch (err) {
            console.error(`Auto-save of diagram ${diagram.id} failed:`, err);
            failed = true;
          }
        }
        if (failed) {
          // Shown until a later save gets everything through
          setSaveStatus('error');
          return;
        }
        setSaveStatus('saved');
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
        statusTimerRef.current = setTimeout(
          () => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)),
          3000,
        );
      } while (againRef.current);
    };

    savingRef.current = run().finally(() => {
      savingRef.current = null;
    });
    return savingRef.current;
  }, []);

  // Let other code (version snapshots) save pending edits immediately
  useEffect(() => {
    const flush = async () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      await saveDirty();
    };
    registerSaveFlusher(flush);
    return () => registerSaveFlusher(null);
  }, [saveDirty]);

  // Debounce after any change to elements or diagram metadata. Subscribed
  // imperatively: re-rendering the editor on every element change (each
  // pointer move of a drag) just to restart a timer was the main cost of
  // dragging in a large diagram.
  useEffect(() => {
    if (!isAuthenticated) return;
    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void saveDirty(), DEBOUNCE_MS);
    };
    schedule();
    const unsubscribeElements = useElementsStore.subscribe((state, prev) => {
      if (state.elements !== prev.elements) schedule();
    });
    const unsubscribeDiagrams = useDiagramStore.subscribe((state, prev) => {
      if (state.diagrams !== prev.diagrams) schedule();
    });
    return () => {
      unsubscribeElements();
      unsubscribeDiagrams();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isAuthenticated, saveDirty]);

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

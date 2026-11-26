import { create } from 'zustand';
import type { MavisElement } from '@mavisdraw/types';
import {
  apiGetSnapshot,
  apiListSnapshots,
  apiRestoreSnapshot,
  apiSaveDiagram,
  type SnapshotSummary,
} from '../services/api';
import { useElementsStore, withoutHistory } from './elementsStore';
import { useDiagramStore } from './diagramStore';
import { isLiveSynced } from './collaborationStore';
import { flushPendingSaves, recordSaved } from '../services/saveTracker';
import { toast } from './toastStore';

/**
 * Shared, server-side version history of the diagram on screen. Everyone on
 * the project sees the same versions; restoring one updates every connected
 * collaborator (the server writes it into the live document).
 */
interface VersionState {
  diagramId: string | null;
  snapshots: SnapshotSummary[];
  isLoading: boolean;

  load: (diagramId: string) => Promise<void>;
  saveSnapshot: (label: string) => Promise<void>;
  /** Called by the auto-snapshot hook after bursts of edits. */
  autoSnapshot: (diagramId?: string) => Promise<void>;
  restoreSnapshot: (snapshotId: string) => Promise<void>;

  /** A version being compared with what's on the canvas now. */
  compare: {
    diagramId: string;
    snapshotId: string;
    title: string;
    createdAt: string;
    elements: MavisElement[];
  } | null;
  startCompare: (snapshotId: string) => Promise<void>;
  stopCompare: () => void;
}

export const useVersionStore = create<VersionState>((set, get) => ({
  diagramId: null,
  snapshots: [],
  isLoading: false,
  compare: null,

  startCompare: async (snapshotId) => {
    const diagramId = useDiagramStore.getState().activeDiagramId;
    try {
      const { snapshot } = await apiGetSnapshot(diagramId, snapshotId);
      if (useDiagramStore.getState().activeDiagramId !== diagramId) return;
      set({
        compare: {
          diagramId,
          snapshotId,
          title: snapshot.label || `Version ${snapshot.version}`,
          createdAt: snapshot.createdAt,
          elements: (snapshot.elements ?? []) as MavisElement[],
        },
      });
    } catch (err) {
      toast(`Couldn't load that version: ${(err as Error).message}`, 'error');
    }
  },

  stopCompare: () => set({ compare: null }),

  load: async (diagramId) => {
    set({ diagramId, isLoading: true });
    try {
      const { snapshots } = await apiListSnapshots(diagramId);
      if (get().diagramId === diagramId) set({ snapshots: snapshots ?? [], isLoading: false });
    } catch (err) {
      console.error('Failed to load versions:', err);
      set({ isLoading: false });
    }
  },

  saveSnapshot: async (label) => {
    const diagramId = useDiagramStore.getState().activeDiagramId;
    // Without a live room the server snapshots what's saved, so save first
    if (!isLiveSynced(diagramId)) await flushPendingSaves();
    await apiSaveDiagram(diagramId, 'manual', label);
    toast(`Saved version "${label}"`, 'success');
    await get().load(diagramId);
  },

  autoSnapshot: async (target) => {
    const diagramId = target ?? useDiagramStore.getState().activeDiagramId;
    try {
      if (!isLiveSynced(diagramId)) await flushPendingSaves();
      await apiSaveDiagram(diagramId, 'auto', 'Auto-save');
      if (get().diagramId === diagramId) await get().load(diagramId);
    } catch (err) {
      console.error('Auto snapshot failed:', err);
    }
  },

  restoreSnapshot: async (snapshotId) => {
    const diagramId = useDiagramStore.getState().activeDiagramId;
    const { diagram } = await apiRestoreSnapshot(diagramId, snapshotId);

    // Live rooms deliver the restore over Y.js; otherwise apply it here
    if (!isLiveSynced(diagramId)) {
      const restored = (diagram.elements ?? []) as MavisElement[];
      withoutHistory(() =>
        useElementsStore.setState((prev) => {
          const next = new Map(prev.elements);
          for (const [id, el] of prev.elements) if (el.diagramId === diagramId) next.delete(id);
          for (const el of restored) next.set(el.id, el);
          // Undo history doesn't span a restore
          return { elements: next, history: [], historyIndex: -1 };
        }),
      );
      recordSaved(diagramId, restored);
    }
    toast('Version restored. The previous state was saved as a backup.', 'success');
    await get().load(diagramId);
  },
}));

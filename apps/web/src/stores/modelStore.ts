import { create } from 'zustand';
import type { ProjectModel } from '@mavisdraw/types';
import { apiGetModel } from '../services/api';

/**
 * The project's architecture model as the server computes it (from every
 * diagram plus recorded details; docs/model-layer.md). Refreshed when the
 * project opens, when a room signals `model`, and after this tab changes it.
 */
interface ModelState {
  projectId: string | null;
  model: ProjectModel | null;
  /** When the model was last fetched (ms), 0 if never. */
  fetchedAt: number;
  load: (projectId: string) => Promise<void>;
  /** Refetch the current project's model (coalesced: one request at a time). */
  refresh: () => Promise<void>;
  reset: () => void;
}

let inFlight: Promise<void> | null = null;
let again = false;

export const useModelStore = create<ModelState>((set, get) => ({
  projectId: null,
  model: null,
  fetchedAt: 0,

  load: async (projectId) => {
    if (get().projectId !== projectId) set({ projectId, model: null, fetchedAt: 0 });
    await get().refresh();
  },

  refresh: async () => {
    if (inFlight) {
      // Something changed while fetching: fetch once more afterwards
      again = true;
      return inFlight;
    }
    const projectId = get().projectId;
    if (!projectId) return;
    inFlight = (async () => {
      try {
        do {
          again = false;
          const { model } = await apiGetModel(projectId);
          if (get().projectId === projectId) set({ model, fetchedAt: Date.now() });
        } while (again && get().projectId === projectId);
      } catch (err) {
        // Offline or no access: keep what we had; the panel works from the drawing
        console.warn('[model] refresh failed:', err);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  reset: () => set({ projectId: null, model: null, fetchedAt: 0 }),
}));

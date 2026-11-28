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
  /**
   * Refetch unless the model was fetched less than `maxAgeMs` ago for this
   * same drawing (`basis`: the elements map then; any edit makes a new one).
   */
  refreshIfOlder: (maxAgeMs: number, basis: object) => Promise<void>;
  reset: () => void;
}

let inFlight: Promise<void> | null = null;
let again = false;
/** What the drawing was when `refreshIfOlder` last fetched. */
let fetchedBasis: object | null = null;

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
      // The project changed while this was fetching: the new one hasn't been
      // fetched yet (its refresh joined this one)
      const now = get().projectId;
      if (now && now !== projectId) await get().refresh();
    })();
    return inFlight;
  },

  refreshIfOlder: async (maxAgeMs, basis) => {
    const { model, fetchedAt } = get();
    if (model && fetchedBasis === basis && Date.now() - fetchedAt < maxAgeMs) return;
    fetchedBasis = basis;
    await get().refresh();
  },

  reset: () => {
    fetchedBasis = null;
    set({ projectId: null, model: null, fetchedAt: 0 });
  },
}));

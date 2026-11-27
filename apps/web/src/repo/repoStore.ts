import { create } from 'zustand';
import type { DriftChange, RepoModel } from '@mavisdraw/compat';
import type { RepoSourceData } from '../services/api';

/**
 * The project's linked repository, and the result of the last drift check.
 * (Kept apart from repoMap.ts so the editor doesn't load the analyzer until
 * it's used.)
 */
interface RepoState {
  source: RepoSourceData | null;
  /** Latest analysis from a drift check (not yet accepted as the baseline). */
  latest: RepoModel | null;
  drift: DriftChange[] | null;
  applied: Set<number>;
  dialogOpen: boolean;
  setSource: (source: RepoSourceData | null) => void;
  setDialogOpen: (open: boolean) => void;
}

export const useRepoStore = create<RepoState>((set) => ({
  source: null,
  latest: null,
  drift: null,
  applied: new Set(),
  dialogOpen: false,
  setSource: (source) => set({ source, latest: null, drift: null, applied: new Set() }),
  setDialogOpen: (dialogOpen) => set({ dialogOpen }),
}));

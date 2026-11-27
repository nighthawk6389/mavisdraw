import { create } from 'zustand';
import { ApiError, apiListProposals, apiResolveProposal, type ProposalData } from '../services/api';
import { goToDiagram } from '../services/diagramSync';
import { useElementsStore } from './elementsStore';
import { toast } from './toastStore';

/**
 * Map updates proposed by coding agents (over MCP), waiting for a person.
 * The server only stores them: applying happens here, in the editor, as one
 * undoable step on the proposal's diagram.
 */
interface ProposalsState {
  projectId: string | null;
  proposals: ProposalData[];
  panelOpen: boolean;
  /** The proposal being applied or dismissed. */
  busyId: string | null;

  load: (projectId: string) => Promise<void>;
  refresh: () => Promise<void>;
  setPanelOpen: (open: boolean) => void;
  /** Open the diagram a proposal changes. */
  show: (id: string) => Promise<void>;
  apply: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  reset: () => void;
}

let loadSeq = 0;

const without = (list: ProposalData[], id: string) => list.filter((p) => p.id !== id);

export const useProposalsStore = create<ProposalsState>((set, get) => ({
  projectId: null,
  proposals: [],
  panelOpen: false,
  busyId: null,

  load: async (projectId) => {
    if (get().projectId !== projectId) set({ projectId, proposals: [], busyId: null });
    const seq = ++loadSeq;
    try {
      const { proposals } = await apiListProposals(projectId);
      // A newer load (or another project) won
      if (seq !== loadSeq || get().projectId !== projectId) return;
      set({ proposals });
    } catch (err) {
      console.error('Failed to load proposals:', err);
    }
  },

  refresh: async () => {
    const { projectId } = get();
    if (projectId) await get().load(projectId);
  },

  setPanelOpen: (open) => {
    set({ panelOpen: open });
    if (open) void get().refresh();
  },

  show: async (id) => {
    const proposal = get().proposals.find((p) => p.id === id);
    if (!proposal) return;
    if (!(await goToDiagram(proposal.diagramId))) {
      toast('The diagram this proposal changes no longer exists', 'error');
    }
  },

  apply: async (id) => {
    const proposal = get().proposals.find((p) => p.id === id);
    if (!proposal || get().busyId) return;
    set({ busyId: id });
    try {
      // Claim it first, so two reviewers can't both apply it
      try {
        await apiResolveProposal(id, 'applied');
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 409) {
          toast('Someone already handled this proposal', 'info');
          set({ proposals: without(get().proposals, id) });
          return;
        }
        throw err;
      }
      try {
        if (!(await goToDiagram(proposal.diagramId))) {
          throw new Error('the diagram it changes no longer exists');
        }
        // Loaded on first use: most sessions never apply a proposal
        const { applyProposal } = await import('../components/agent/applyProposal');
        const result = await applyProposal({
          proposalId: proposal.id,
          description: proposal.description,
          changes: proposal.changes,
          connections: proposal.connections,
          status: 'pending',
        });
        set({ proposals: without(get().proposals, id) });
        const parts = [
          result.added && `${result.added} added`,
          result.connected && `${result.connected} connected`,
          result.recorded && `${result.recorded} recorded (drawn on other diagrams)`,
          result.modified && `${result.modified} changed`,
          result.deleted && `${result.deleted} removed`,
        ].filter(Boolean);
        toast(`Applied: ${parts.join(', ') || 'no changes'}`, 'success', {
          label: 'Undo',
          run: () => useElementsStore.getState().undo(),
        });
      } catch (err) {
        // Put it back in the queue for another try
        await apiResolveProposal(id, 'pending').catch(() => undefined);
        throw err;
      }
    } catch (err) {
      toast(
        `Couldn't apply the proposal: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    } finally {
      set({ busyId: null });
    }
  },

  dismiss: async (id) => {
    if (get().busyId) return;
    set({ busyId: id });
    try {
      await apiResolveProposal(id, 'dismissed');
      set({ proposals: without(get().proposals, id) });
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        set({ proposals: without(get().proposals, id) });
      } else {
        toast(`Couldn't dismiss it: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    } finally {
      set({ busyId: null });
    }
  },

  reset: () => set({ projectId: null, proposals: [], panelOpen: false, busyId: null }),
}));

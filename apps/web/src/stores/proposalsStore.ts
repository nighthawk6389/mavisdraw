import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { ApiError, apiListProposals, apiResolveProposal, type ProposalData } from '../services/api';
import { goToDiagram, loadDiagramElements } from '../services/diagramSync';
import { useElementsStore } from './elementsStore';
import { toast } from './toastStore';

/**
 * Map updates proposed by coding agents (over MCP), waiting for a person.
 * The server only stores them: applying happens here, in the editor, as one
 * undoable step on the proposal's diagram.
 *
 * Applied first, then marked applied on the server: a failed apply leaves
 * the proposal waiting (nothing to undo there), and if someone else marked
 * it applied a moment earlier, this editor's copy is undone.
 */

/** Retries after a lost answer (network, or the server restarting). */
const MARK_RETRIES_MS = [400, 1500];

/**
 * Tell the server this proposal is applied. 'taken': someone else got there
 * first. 'unconfirmed': the server couldn't be reached to say so.
 */
async function markApplied(
  id: string,
  // The same key on every try: a retry after a lost answer is "done", not "taken"
  key = nanoid(),
  retriesMs: readonly number[] = MARK_RETRIES_MS,
): Promise<'done' | 'taken' | 'unconfirmed'> {
  for (let attempt = 0; ; attempt++) {
    try {
      await apiResolveProposal(id, 'applied', key);
      return 'done';
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) return 'taken';
      // Refused (lost edit access, gone): not worth asking again
      if (err instanceof ApiError && err.statusCode < 500) throw err;
      if (attempt >= retriesMs.length) return 'unconfirmed';
      await new Promise((r) => setTimeout(r, retriesMs[attempt]));
    }
  }
}

/**
 * Keep telling the server, with the same key, until it hears: otherwise it
 * stays "waiting" there, and someone could apply it a second time.
 */
const LATER_RETRIES_MS = [10_000, 30_000, 90_000, 300_000];
function keepMarking(id: string, key: string): void {
  void markApplied(id, key, LATER_RETRIES_MS)
    .then((outcome) => {
      if (outcome === 'unconfirmed') console.warn(`[proposals] ${id} still not marked applied`);
    })
    .catch((err) => console.warn(`[proposals] marking ${id} applied failed:`, err));
}
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
      if (!(await goToDiagram(proposal.diagramId))) {
        throw new Error('the diagram it changes no longer exists');
      }
      // Only onto what's really there: on a level that didn't load, the
      // shapes it already has would be missed and added again
      await loadDiagramElements(proposal.diagramId).catch(() => {
        throw new Error('its diagram didn’t load. Try again in a moment');
      });
      // Loaded on first use: most sessions never apply a proposal
      const { applyProposal } = await import('../components/agent/applyProposal');
      // All or nothing: if it fails, the map is as it was and the proposal still waits
      const result = await applyProposal(
        {
          proposalId: proposal.id,
          description: proposal.description,
          changes: proposal.changes,
          connections: proposal.connections,
          status: 'pending',
        },
        { diagramId: proposal.diagramId },
      );
      // Only ever its own step: if the person edited since, undo would take theirs
      const takeBack = () => {
        if (useElementsStore.getState().historyIndex === result.step) {
          useElementsStore.getState().undo();
          return true;
        }
        return false;
      };

      let marked: Awaited<ReturnType<typeof markApplied>>;
      const key = nanoid();
      try {
        marked = await markApplied(id, key);
      } catch (err) {
        takeBack();
        throw err;
      }
      set({ proposals: without(get().proposals, id) });
      if (marked === 'taken') {
        toast(
          takeBack()
            ? 'Someone else applied this proposal a moment earlier, so yours was undone'
            : 'Someone else applied this proposal a moment earlier: undo yours (Ctrl+Z) to avoid doubles',
          'info',
        );
        return;
      }
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
      if (marked === 'unconfirmed') {
        keepMarking(id, key);
        toast(
          'Applied, but the server couldn’t be told yet: others may see it as waiting for a little while',
          'info',
        );
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

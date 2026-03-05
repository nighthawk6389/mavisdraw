import { create } from 'zustand';
import type { DiagramProposal } from '@mavisdraw/types';

interface AgentState {
  proposals: Map<string, DiagramProposal>;

  addProposal: (proposal: DiagramProposal) => void;
  updateProposalStatus: (id: string, status: DiagramProposal['status']) => void;
  clearProposals: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  proposals: new Map(),

  addProposal: (proposal) => {
    set((prev) => {
      const next = new Map(prev.proposals);
      next.set(proposal.proposalId, proposal);
      return { proposals: next };
    });
  },

  updateProposalStatus: (id, status) => {
    set((prev) => {
      const existing = prev.proposals.get(id);
      if (!existing) return prev;
      const next = new Map(prev.proposals);
      next.set(id, { ...existing, status });
      return { proposals: next };
    });
  },

  clearProposals: () => {
    set({ proposals: new Map() });
  },
}));

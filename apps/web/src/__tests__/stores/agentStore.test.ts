import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../../stores/agentStore';
import type { DiagramProposal } from '@mavisdraw/types';

function resetStore() {
  useAgentStore.setState({ proposals: new Map() });
}

function makeProposal(overrides?: Partial<DiagramProposal>): DiagramProposal {
  return {
    proposalId: 'test-1',
    description: 'Add a database service',
    changes: [{ action: 'add', elementType: 'rectangle', label: 'Database' }],
    connections: [],
    status: 'pending',
    ...overrides,
  };
}

describe('agentStore', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('initial state', () => {
    it('starts with empty proposals', () => {
      const state = useAgentStore.getState();
      expect(state.proposals.size).toBe(0);
    });
  });

  describe('addProposal', () => {
    it('adds a proposal to the map', () => {
      const proposal = makeProposal();
      useAgentStore.getState().addProposal(proposal);

      const state = useAgentStore.getState();
      expect(state.proposals.size).toBe(1);
      expect(state.proposals.get('test-1')).toEqual(proposal);
    });

    it('adds multiple proposals', () => {
      useAgentStore.getState().addProposal(makeProposal({ proposalId: 'p1' }));
      useAgentStore.getState().addProposal(makeProposal({ proposalId: 'p2' }));

      expect(useAgentStore.getState().proposals.size).toBe(2);
    });
  });

  describe('updateProposalStatus', () => {
    it('marks a proposal as applied', () => {
      useAgentStore.getState().addProposal(makeProposal());
      useAgentStore.getState().updateProposalStatus('test-1', 'applied');

      expect(useAgentStore.getState().proposals.get('test-1')?.status).toBe('applied');
    });

    it('marks a proposal as dismissed', () => {
      useAgentStore.getState().addProposal(makeProposal());
      useAgentStore.getState().updateProposalStatus('test-1', 'dismissed');

      expect(useAgentStore.getState().proposals.get('test-1')?.status).toBe('dismissed');
    });

    it('does nothing for unknown proposal ID', () => {
      useAgentStore.getState().addProposal(makeProposal());
      useAgentStore.getState().updateProposalStatus('nonexistent', 'applied');

      expect(useAgentStore.getState().proposals.get('test-1')?.status).toBe('pending');
    });
  });

  describe('clearProposals', () => {
    it('removes all proposals', () => {
      useAgentStore.getState().addProposal(makeProposal({ proposalId: 'p1' }));
      useAgentStore.getState().addProposal(makeProposal({ proposalId: 'p2' }));
      useAgentStore.getState().clearProposals();

      expect(useAgentStore.getState().proposals.size).toBe(0);
    });
  });
});

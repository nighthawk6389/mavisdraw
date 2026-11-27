import React, { useState } from 'react';
import type { DiagramProposal } from '@mavisdraw/types';
import ProposalChangeList from './ProposalChangeList';
import { useAgentStore } from '../../stores/agentStore';
import { useElementsStore } from '../../stores/elementsStore';
import { toast } from '../../stores/toastStore';
import { applyProposal } from './applyProposal';

export default function ProposalCard({ proposal }: { proposal: DiagramProposal }) {
  const updateProposalStatus = useAgentStore((s) => s.updateProposalStatus);

  const [applying, setApplying] = useState(false);

  const handleApply = async () => {
    setApplying(true);
    try {
      const result = await applyProposal(proposal);
      updateProposalStatus(proposal.proposalId, 'applied');
      const parts = [
        result.added && `${result.added} added`,
        result.connected && `${result.connected} connected`,
        result.modified && `${result.modified} changed`,
        result.deleted && `${result.deleted} removed`,
      ].filter(Boolean);
      toast(`Applied: ${parts.join(', ') || 'no changes'}`, 'success', {
        label: 'Undo',
        run: () => useElementsStore.getState().undo(),
      });
    } catch (err) {
      toast(
        `Couldn't apply proposal: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    } finally {
      setApplying(false);
    }
  };

  const handleDismiss = () => {
    updateProposalStatus(proposal.proposalId, 'dismissed');
  };

  const isResolved = proposal.status !== 'pending';

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 text-sm">
      <p className="font-medium text-gray-800 mb-2">{proposal.description}</p>

      <ProposalChangeList
        changes={proposal.changes}
        connections={proposal.connections}
        className="mb-3"
      />

      {isResolved ? (
        <span
          className={`text-xs font-medium px-2 py-1 rounded ${
            proposal.status === 'applied'
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-500'
          }`}
        >
          {proposal.status === 'applied' ? 'Applied' : 'Dismissed'}
        </span>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => void handleApply()}
            disabled={applying}
            className="px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
          >
            {applying ? 'Applying…' : 'Apply'}
          </button>
          <button
            onClick={handleDismiss}
            className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-200 hover:bg-gray-300 rounded"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

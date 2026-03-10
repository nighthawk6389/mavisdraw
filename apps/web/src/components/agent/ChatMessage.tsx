import React from 'react';
import type { UIMessage } from 'ai';
import type { DiagramProposal } from '@mavisdraw/types';
import ProposalCard from './ProposalCard';

function ToolPart({ part }: { part: { type: string; state?: string; output?: unknown; toolName?: string } }) {
  // Detect tool name from the part type (e.g., "tool-propose_changes")
  const toolName = part.type.startsWith('tool-') ? part.type.slice(5) : (part.toolName ?? '');

  if (toolName === 'propose_changes' && part.state === 'result') {
    const proposal = part.output as DiagramProposal;
    if (proposal?.proposalId) {
      return <ProposalCard proposal={proposal} />;
    }
  }

  // Show status for in-progress tool calls
  if (part.state === 'call' || part.state === 'partial-call' || part.state === 'input-streaming' || part.state === 'input-available') {
    const labels: Record<string, string> = {
      browse_diagram: 'Viewing diagram...',
      browse_code: 'Browsing code...',
      read_file: 'Reading file...',
      propose_changes: 'Preparing proposal...',
    };
    return (
      <p className="text-xs text-gray-400 italic py-1">
        {labels[toolName] ?? `Running ${toolName}...`}
      </p>
    );
  }

  // Completed non-proposal tools
  if (part.state === 'result') {
    const labels: Record<string, string> = {
      browse_diagram: 'Viewed diagram',
      browse_code: 'Browsed code',
      read_file: 'Read file',
    };
    const label = labels[toolName];
    if (label) {
      return <p className="text-xs text-gray-400 italic py-1">{label}</p>;
    }
  }

  return null;
}

export default function ChatMessage({ message }: { message: UIMessage }) {
  const { role, parts } = message;

  if (role === 'user') {
    // Extract text from parts
    const text = parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('');

    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-3 py-2 rounded-lg bg-blue-600 text-white text-sm whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex flex-col gap-2">
      {parts.map((part, i) => {
        if (part.type === 'text' && part.text) {
          return (
            <div
              key={i}
              className="max-w-[85%] px-3 py-2 rounded-lg bg-gray-100 text-gray-800 text-sm whitespace-pre-wrap"
            >
              {part.text}
            </div>
          );
        }

        // Tool parts have types like "tool-browse_code", "tool-propose_changes", etc.
        if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
          return <ToolPart key={i} part={part as { type: string; state?: string; output?: unknown; toolName?: string }} />;
        }

        return null;
      })}
    </div>
  );
}

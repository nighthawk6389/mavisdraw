import React from 'react';
import type { DiagramProposal, ProposedChange, ElementType } from '@mavisdraw/types';
import { useAgentStore } from '../../stores/agentStore';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';

function changeIcon(change: ProposedChange): string {
  switch (change.action) {
    case 'add':
      return '+';
    case 'modify':
      return '~';
    case 'delete':
      return '-';
  }
}

function changeLabel(change: ProposedChange): string {
  switch (change.action) {
    case 'add':
      return `Add "${change.label}" (${change.elementType})`;
    case 'modify':
      return `Modify "${change.label ?? change.elementId}"`;
    case 'delete':
      return `Delete "${change.elementId}"`;
  }
}

function changeColor(change: ProposedChange): string {
  switch (change.action) {
    case 'add':
      return 'text-green-700';
    case 'modify':
      return 'text-yellow-700';
    case 'delete':
      return 'text-red-700';
  }
}

export default function ProposalCard({ proposal }: { proposal: DiagramProposal }) {
  const updateProposalStatus = useAgentStore((s) => s.updateProposalStatus);

  const handleApply = () => {
    const elementsStore = useElementsStore.getState();
    const activeDiagramId = useDiagramStore.getState().activeDiagramId;

    // Single history push for one undo step
    elementsStore.pushHistory();

    // Build label→id map from existing elements
    const labelToId = new Map<string, string>();
    for (const [id, el] of elementsStore.elements) {
      if (el.isDeleted) continue;
      // Check bound text for label
      for (const bound of el.boundElements) {
        if (bound.type === 'text') {
          const textEl = elementsStore.elements.get(bound.id);
          if (textEl && textEl.type === 'text' && 'text' in textEl) {
            const text = (textEl as { text: string }).text.trim();
            if (text) labelToId.set(text, id);
          }
        }
      }
      // Portal labels
      if (el.type === 'portal' && 'label' in el) {
        const label = (el as { label: string }).label;
        if (label) labelToId.set(label, id);
      }
    }

    // Track newly created elements by label for connections
    const newLabelToId = new Map<string, string>(labelToId);

    // Apply changes
    const GRID = 120;
    let addIndex = 0;

    for (const change of proposal.changes) {
      switch (change.action) {
        case 'add': {
          const x = 100 + (addIndex % 4) * (GRID + 40);
          const y = 100 + Math.floor(addIndex / 4) * (GRID + 40);
          const elementType = change.elementType as ElementType;
          const el = elementsStore.createElement(elementType, activeDiagramId, x, y, GRID, 80);
          // Add without pushing history (we already pushed once)
          useElementsStore.setState((prev) => {
            const next = new Map(prev.elements);
            next.set(el.id, el);
            return { elements: next };
          });

          // Create bound text label
          if (change.label && elementType !== 'arrow') {
            const textEl = elementsStore.createElement(
              'text',
              activeDiagramId,
              el.x + 10,
              el.y + 10,
              el.width - 20,
              el.height - 20,
            );
            const boundText = {
              ...textEl,
              type: 'text' as const,
              text: change.label,
              fontSize: 16,
              fontFamily: 'hand-drawn' as const,
              textAlign: 'center' as const,
              verticalAlign: 'middle' as const,
              containerId: el.id,
              lineHeight: 1.25,
              strokeWidth: 0,
            };
            useElementsStore.setState((prev) => {
              const next = new Map(prev.elements);
              next.set(boundText.id, boundText as never);
              // Add text to container's boundElements
              const container = next.get(el.id);
              if (container) {
                next.set(el.id, {
                  ...container,
                  boundElements: [...container.boundElements, { id: boundText.id, type: 'text' }],
                } as never);
              }
              return { elements: next };
            });
          }

          newLabelToId.set(change.label, el.id);
          addIndex++;
          break;
        }

        case 'modify': {
          const targetId = change.elementId || labelToId.get(change.label ?? '');
          if (!targetId) break;
          if (change.properties) {
            useElementsStore.setState((prev) => {
              const next = new Map(prev.elements);
              const current = next.get(targetId);
              if (current) {
                next.set(targetId, {
                  ...current,
                  ...change.properties,
                  version: current.version + 1,
                  updatedAt: Date.now(),
                } as never);
              }
              return { elements: next };
            });
          }
          if (change.label) {
            // Update bound text
            const el = elementsStore.elements.get(targetId);
            if (el) {
              const textBound = el.boundElements.find((b) => b.type === 'text');
              if (textBound) {
                useElementsStore.setState((prev) => {
                  const next = new Map(prev.elements);
                  const textEl = next.get(textBound.id);
                  if (textEl && textEl.type === 'text') {
                    next.set(textBound.id, {
                      ...textEl,
                      text: change.label,
                      version: textEl.version + 1,
                      updatedAt: Date.now(),
                    } as never);
                  }
                  return { elements: next };
                });
              }
            }
          }
          break;
        }

        case 'delete': {
          const targetId = change.elementId || labelToId.get(change.elementId);
          if (!targetId) break;
          useElementsStore.setState((prev) => {
            const next = new Map(prev.elements);
            const el = next.get(targetId);
            if (el) {
              next.set(targetId, {
                ...el,
                isDeleted: true,
                version: el.version + 1,
                updatedAt: Date.now(),
              } as never);
            }
            return { elements: next };
          });
          break;
        }
      }
    }

    // Apply connections
    for (const conn of proposal.connections) {
      const fromId = newLabelToId.get(conn.fromLabel);
      const toId = newLabelToId.get(conn.toLabel);
      if (!fromId || !toId) continue;

      const fromEl = useElementsStore.getState().elements.get(fromId);
      const toEl = useElementsStore.getState().elements.get(toId);
      if (!fromEl || !toEl) continue;

      // Create arrow between the two elements
      const startX = fromEl.x + fromEl.width;
      const startY = fromEl.y + fromEl.height / 2;
      const endX = toEl.x;
      const endY = toEl.y + toEl.height / 2;

      const arrow = elementsStore.createElement(
        'arrow',
        activeDiagramId,
        startX,
        startY,
        endX - startX,
        endY - startY,
      );

      useElementsStore.setState((prev) => {
        const next = new Map(prev.elements);
        // Set arrow with bindings
        next.set(arrow.id, {
          ...arrow,
          startBinding: { elementId: fromId, gap: 0 },
          endBinding: { elementId: toId, gap: 0 },
        } as never);
        // Update source boundElements
        const source = next.get(fromId);
        if (source) {
          next.set(fromId, {
            ...source,
            boundElements: [...source.boundElements, { id: arrow.id, type: 'arrow' }],
          } as never);
        }
        // Update target boundElements
        const target = next.get(toId);
        if (target) {
          next.set(toId, {
            ...target,
            boundElements: [...target.boundElements, { id: arrow.id, type: 'arrow' }],
          } as never);
        }
        return { elements: next };
      });

      // Add connection label if provided
      if (conn.label) {
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        const labelEl = elementsStore.createElement(
          'text',
          activeDiagramId,
          midX - 30,
          midY - 10,
          60,
          20,
        );
        useElementsStore.setState((prev) => {
          const next = new Map(prev.elements);
          next.set(labelEl.id, {
            ...labelEl,
            type: 'text',
            text: conn.label,
            fontSize: 14,
            fontFamily: 'hand-drawn',
            textAlign: 'center',
            verticalAlign: 'middle',
            containerId: arrow.id,
            lineHeight: 1.25,
            strokeWidth: 0,
          } as never);
          // Add to arrow's boundElements
          const arrowEl = next.get(arrow.id);
          if (arrowEl) {
            next.set(arrow.id, {
              ...arrowEl,
              boundElements: [...arrowEl.boundElements, { id: labelEl.id, type: 'text' }],
            } as never);
          }
          return { elements: next };
        });
      }
    }

    updateProposalStatus(proposal.proposalId, 'applied');
  };

  const handleDismiss = () => {
    updateProposalStatus(proposal.proposalId, 'dismissed');
  };

  const isResolved = proposal.status !== 'pending';

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 text-sm">
      <p className="font-medium text-gray-800 mb-2">{proposal.description}</p>

      <ul className="space-y-1 mb-3">
        {proposal.changes.map((change, i) => (
          <li key={i} className={`flex items-center gap-1 ${changeColor(change)}`}>
            <span className="font-mono text-xs w-4 text-center">{changeIcon(change)}</span>
            <span>{changeLabel(change)}</span>
          </li>
        ))}
        {proposal.connections.map((conn, i) => (
          <li key={`conn-${i}`} className="flex items-center gap-1 text-blue-700">
            <span className="font-mono text-xs w-4 text-center">&rarr;</span>
            <span>
              &quot;{conn.fromLabel}&quot; &rarr; &quot;{conn.toLabel}&quot;
              {conn.label && <span className="text-gray-500"> ({conn.label})</span>}
            </span>
          </li>
        ))}
      </ul>

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
            onClick={handleApply}
            className="px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded"
          >
            Apply
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

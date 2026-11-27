import type { ProposedChange, ProposedConnection } from '@mavisdraw/types';

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

/** Names the element by label when the change carries one, otherwise by id. */
function changeLabel(change: ProposedChange, names?: Map<string, string>): string {
  switch (change.action) {
    case 'add':
      return `Add "${change.label}" (${change.elementType})`;
    case 'modify': {
      const current = names?.get(change.elementId);
      return current && change.label
        ? `Rename "${current}" to "${change.label}"`
        : `Modify "${change.label ?? current ?? change.elementId}"`;
    }
    case 'delete':
      return `Delete "${names?.get(change.elementId) ?? change.elementId}"`;
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

/** What a proposal adds, changes, removes and connects. */
export default function ProposalChangeList({
  changes,
  connections,
  names,
  className = '',
}: {
  changes: ProposedChange[];
  connections: ProposedConnection[];
  /** Current labels by element id, to describe renames and removals. */
  names?: Map<string, string>;
  className?: string;
}) {
  return (
    <ul className={`space-y-1 ${className}`}>
      {changes.map((change, i) => (
        <li key={i} className={`flex items-center gap-1 ${changeColor(change)}`}>
          <span className="w-4 text-center font-mono text-xs">{changeIcon(change)}</span>
          <span>{changeLabel(change, names)}</span>
        </li>
      ))}
      {connections.map((conn, i) => (
        <li key={`conn-${i}`} className="flex items-center gap-1 text-blue-700">
          <span className="w-4 text-center font-mono text-xs">&rarr;</span>
          <span>
            &quot;{conn.fromLabel}&quot; &rarr; &quot;{conn.toLabel}&quot;
            {conn.label && <span className="text-gray-500"> ({conn.label})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

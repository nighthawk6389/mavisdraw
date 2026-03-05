// ── Agent / AI Chat Types ──────────────────────────────────

export interface ProposedChangeAdd {
  action: 'add';
  elementType: string; // 'rectangle' | 'ellipse' | 'diamond' | 'portal' | 'arrow'
  label: string;
  properties?: Record<string, unknown>;
}

export interface ProposedChangeModify {
  action: 'modify';
  elementId: string;
  label?: string;
  properties?: Record<string, unknown>;
}

export interface ProposedChangeDelete {
  action: 'delete';
  elementId: string;
}

export type ProposedChange = ProposedChangeAdd | ProposedChangeModify | ProposedChangeDelete;

export interface ProposedConnection {
  fromLabel: string;
  toLabel: string;
  label?: string;
}

export interface DiagramProposal {
  proposalId: string;
  description: string;
  changes: ProposedChange[];
  connections: ProposedConnection[];
  status: 'pending' | 'applied' | 'dismissed';
}

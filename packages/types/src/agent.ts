// ── Agent / AI Chat Types ──────────────────────────────────

export interface ProposedChangeAdd {
  action: 'add';
  elementType: string; // 'rectangle' | 'ellipse' | 'diamond' | 'portal' | 'arrow'
  label: string;
  properties?: Record<string, unknown>;
  /**
   * Show a component the map already has (drawn on another diagram) here, as
   * another appearance of it rather than a new component.
   */
  componentId?: string;
  /** Where that component is drawn already ("Shop › Payments"), for reviewers. */
  drawnOn?: string;
  /** The nested diagram it opens into, if any (an added portal reuses it). */
  detailDiagramId?: string;
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
  /**
   * Set for an end that's a component drawn only on another diagram: the
   * relationship is recorded in the architecture model rather than drawn
   * here. (An end on this diagram is resolved by its label when applied.)
   */
  fromComponentId?: string;
  toComponentId?: string;
}

export interface DiagramProposal {
  proposalId: string;
  description: string;
  changes: ProposedChange[];
  connections: ProposedConnection[];
  status: 'pending' | 'applied' | 'dismissed';
}

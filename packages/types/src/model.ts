// ── The architecture model (docs/model-layer.md) ─────────────
// Types only: runtime helpers live in @mavisdraw/llm (this package isn't
// loaded at runtime by the server).

export type ModelComponentKind =
  | 'service'
  | 'datastore'
  | 'queue'
  | 'external'
  | 'system'
  | 'person'
  | 'other';

export interface ModelLink {
  label: string;
  url: string;
}

/** What the component panel and agents can say about a component (stored per project). */
export interface ComponentDetails {
  kind?: ModelComponentKind;
  description?: string | null;
  technology?: string | null;
  owner?: string | null;
  tags?: string[];
  links?: ModelLink[];
}

/** A stored component row (metadata, and the name of model-only components). */
export interface StoredComponent extends ComponentDetails {
  id: string;
  name: string;
}

/** A stored relationship row (metadata, or one nobody has drawn). */
export interface StoredRelationship {
  sourceId: string;
  targetId: string;
  description?: string | null;
  technology?: string | null;
}

/** A shape showing a component. */
export interface ModelAppearance {
  diagramId: string;
  elementId: string;
  /** Diagram titles from the top-level map down. */
  path: string[];
}

export interface ModelComponent {
  id: string;
  name: string;
  kind: ModelComponentKind;
  description: string | null;
  technology: string | null;
  owner: string | null;
  tags: string[];
  links: ModelLink[];
  /** The repository folder it stands for. */
  code: { repo?: string; path: string } | null;
  /** The nested diagram it opens into. */
  detailDiagramId: string | null;
  appearances: ModelAppearance[];
  /** Components it sits inside (it appears on their detail diagrams). */
  parents: string[];
  /** Has stored details (or exists only in the model). */
  stored: boolean;
}

export interface ModelRelationship {
  /** `${sourceId}->${targetId}` */
  id: string;
  sourceId: string;
  targetId: string;
  description: string | null;
  technology: string | null;
  /** Labels on the arrows that draw it. */
  labels: string[];
  /** The arrows that draw it. */
  drawn: Array<{ diagramId: string; elementId: string }>;
  stored: boolean;
}

export interface ProjectModel {
  components: ModelComponent[];
  relationships: ModelRelationship[];
}

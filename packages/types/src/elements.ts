export type ElementType =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'cylinder'
  | 'queue'
  | 'line'
  | 'arrow'
  | 'freedraw'
  | 'text'
  | 'image'
  | 'portal';

export type FillStyle = 'solid' | 'hachure' | 'cross-hatch' | 'none';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type RenderMode = 'sketchy' | 'clean';
export type Arrowhead = 'none' | 'arrow' | 'dot' | 'bar' | 'triangle';
export type RoutingMode = 'straight' | 'curved' | 'elbow';
export type FontFamily = 'hand-drawn' | 'sans-serif' | 'monospace';
export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type PortalStyle = 'card' | 'badge' | 'expanded';

export type AnchorPosition = 'top' | 'right' | 'bottom' | 'left';

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BaseElement {
  id: string;
  type: ElementType;
  diagramId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;

  // Styling
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  seed: number;
  renderMode: RenderMode;

  // Organization
  layerId: string;
  groupIds: string[];
  isLocked: boolean;
  isDeleted: boolean;
  /**
   * Stacking order within a diagram (higher renders on top). Optional for
   * backward compatibility: elements without it render in insertion order
   * beneath elements that have one.
   */
  zIndex?: number;

  /**
   * The architecture component this shape shows (see docs/model-layer.md).
   * Shared by every appearance of the component, on any diagram; unset on
   * plain drawing (unlabelled shapes, free text, arrows, doodles).
   */
  componentId?: string;

  /**
   * An icon drawn inside the shape, by id (see @mavisdraw/export/library).
   * Unknown ids draw nothing.
   */
  icon?: string;

  // Binding
  boundElements: { id: string; type: string }[];

  // Versioning
  version: number;
  updatedAt: number;
}

export interface RectangleElement extends BaseElement {
  type: 'rectangle';
  roundness: number;
}

export interface EllipseElement extends BaseElement {
  type: 'ellipse';
}

export interface DiamondElement extends BaseElement {
  type: 'diamond';
}

export interface TriangleElement extends BaseElement {
  type: 'triangle';
}

/** A datastore: a cylinder standing up. */
export interface CylinderElement extends BaseElement {
  type: 'cylinder';
}

/** A message queue or stream: a cylinder on its side. */
export interface QueueElement extends BaseElement {
  type: 'queue';
}

export interface LinearElement extends BaseElement {
  type: 'line' | 'arrow' | 'freedraw';
  points: [number, number][];
  startBinding: { elementId: string; gap: number } | null;
  endBinding: { elementId: string; gap: number } | null;
  routingMode: RoutingMode;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  /** When true, elbow routing uses stored points rather than computing on-the-fly. */
  elbowManualRoute?: boolean;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: FontFamily;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  containerId: string | null;
  lineHeight: number;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  imageUrl: string;
  aspectRatio: number;
}

export interface GitHubLink {
  owner: string;
  repo: string;
  path: string;
  ref: string;
  enterpriseUrl?: string;
}

export interface PortalElement extends BaseElement {
  type: 'portal';
  targetDiagramId: string;
  label: string;
  thumbnailDataUrl: string | null;
  portalStyle: PortalStyle;
  githubLink: GitHubLink | null;
  /** Folder in the linked repository this level stands for (set by repo → map). */
  codePath?: string | null;
}

export type MavisElement =
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | TriangleElement
  | CylinderElement
  | QueueElement
  | LinearElement
  | TextElement
  | ImageElement
  | PortalElement;

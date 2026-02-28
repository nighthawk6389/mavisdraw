export type ElementType =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
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
  renderMode: RenderMode;

  // Organization
  layerId: string;
  groupIds: string[];
  isLocked: boolean;
  isDeleted: boolean;

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

export interface LinearElement extends BaseElement {
  type: 'line' | 'arrow' | 'freedraw';
  points: [number, number][];
  startBinding: { elementId: string; gap: number } | null;
  endBinding: { elementId: string; gap: number } | null;
  routingMode: RoutingMode;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
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

export interface PortalElement extends BaseElement {
  type: 'portal';
  targetDiagramId: string;
  label: string;
  thumbnailDataUrl: string | null;
  portalStyle: PortalStyle;
}

export type MavisElement =
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | TriangleElement
  | LinearElement
  | TextElement
  | ImageElement
  | PortalElement;

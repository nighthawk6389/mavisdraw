/** Excalidraw element types based on their public JSON format. */

export interface ExcalidrawElement {
  id: string;
  type:
    | 'rectangle'
    | 'ellipse'
    | 'diamond'
    | 'line'
    | 'arrow'
    | 'freedraw'
    | 'text'
    | 'image'
    | 'frame';
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: 'solid' | 'hachure' | 'cross-hatch' | 'zigzag';
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  roughness: number;
  opacity: number;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  groupIds: string[];
  boundElements: { id: string; type: string }[] | null;
  updated: number;
  link: string | null;
  locked: boolean;
  roundness: { type: number; value?: number } | null;
  index?: string;
  frameId?: string | null;

  // Linear element fields
  points?: [number, number][];
  startBinding?: { elementId: string; focus: number; gap: number } | null;
  endBinding?: { elementId: string; focus: number; gap: number } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  lastCommittedPoint?: [number, number] | null;
  elbowed?: boolean;

  // Text element fields
  text?: string;
  originalText?: string;
  fontSize?: number;
  fontFamily?: number; // 1=hand-drawn, 2=sans-serif, 3=monospace
  textAlign?: string;
  verticalAlign?: string;
  containerId?: string | null;
  lineHeight?: number;
  autoResize?: boolean;
  baseline?: number;

  // Image element fields
  fileId?: string | null;
  scale?: [number, number];
  status?: string;

  // Freedraw fields
  pressures?: number[];
  simulatePressure?: boolean;
}

export interface ExcalidrawAppState {
  viewBackgroundColor: string;
  gridSize: number | null;
}

export interface ExcalidrawFile {
  type: 'excalidraw';
  version: number;
  source: string;
  elements: ExcalidrawElement[];
  appState: ExcalidrawAppState;
  files?: Record<
    string,
    {
      mimeType: string;
      id: string;
      dataURL: string;
      created: number;
    }
  >;
}

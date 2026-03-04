/** Parsed representation of a draw.io mxCell. */
export interface DrawioCell {
  id: string;
  value: string;
  style: string;
  vertex: boolean;
  edge: boolean;
  source?: string;
  target?: string;
  parent: string;
  geometry?: DrawioGeometry;
}

export interface DrawioGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  relative?: boolean;
  points?: { x: number; y: number }[];
}

export interface DrawioDiagram {
  name: string;
  id: string;
  cells: DrawioCell[];
  gridSize?: number;
  background?: string;
}

export interface DrawioFile {
  diagrams: DrawioDiagram[];
}

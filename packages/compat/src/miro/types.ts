/** Miro REST API v2 compatible item types. */

export interface MiroPosition {
  x: number;
  y: number;
}

export interface MiroGeometry {
  width: number;
  height?: number;
  rotation?: number; // degrees
}

export interface MiroShapeItem {
  type: 'shape';
  data: {
    shape:
      | 'rectangle'
      | 'round_rectangle'
      | 'circle'
      | 'triangle'
      | 'rhombus'
      | 'star'
      | 'hexagon';
    content: string;
  };
  style: {
    fillColor: string;
    fillOpacity: string;
    borderColor: string;
    borderWidth: string;
    borderOpacity: string;
    borderStyle: 'normal' | 'dashed' | 'dotted';
    fontFamily: string;
    fontSize: string;
    textAlign: string;
    textAlignVertical: string;
    color: string;
  };
  position: MiroPosition;
  geometry: MiroGeometry;
}

export interface MiroTextItem {
  type: 'text';
  data: {
    content: string;
  };
  style: {
    fillColor: string;
    fillOpacity: string;
    color: string;
    fontFamily: string;
    fontSize: string;
    textAlign: string;
  };
  position: MiroPosition;
  geometry: MiroGeometry;
}

export interface MiroConnectorItem {
  type: 'connector';
  data: {
    shape: 'straight' | 'curved' | 'elbowed';
  };
  style: {
    startStrokeCap:
      | 'none'
      | 'arrow'
      | 'filled_arrow'
      | 'filled_circle'
      | 'filled_diamond';
    endStrokeCap:
      | 'none'
      | 'arrow'
      | 'filled_arrow'
      | 'filled_circle'
      | 'filled_diamond';
    strokeColor: string;
    strokeWidth: string;
    strokeStyle: 'normal' | 'dashed' | 'dotted';
  };
  startItem?: { id: string };
  endItem?: { id: string };
}

export type MiroItem = MiroShapeItem | MiroTextItem | MiroConnectorItem;

export interface MiroBoardExport {
  type: 'miro-board';
  version: 1;
  items: MiroItem[];
}

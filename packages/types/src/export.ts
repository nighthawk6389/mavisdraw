import type { Diagram } from './diagram';
import type { MavisElement, RenderMode } from './elements';

// ---------------------------------------------------------------------------
// Native .mavisdraw file format
// ---------------------------------------------------------------------------

/** The .mavisdraw native file format. */
export interface MavisDrawFile {
  type: 'mavisdraw';
  version: 1;
  appVersion: string;
  exportedAt: number;
  scene: MavisDrawScene;
  appState?: MavisDrawAppState;
}

export interface MavisDrawScene {
  diagrams: Diagram[];
  elements: MavisElement[];
  rootDiagramId: string;
}

export interface MavisDrawAppState {
  renderMode: RenderMode;
  viewBackgroundColor: string;
  gridEnabled: boolean;
  gridSize: number;
}

// ---------------------------------------------------------------------------
// Export options
// ---------------------------------------------------------------------------

export type ExportFormat =
  | 'mavisdraw'
  | 'png'
  | 'svg'
  | 'pdf'
  | 'excalidraw'
  | 'drawio'
  | 'miro';

export interface ExportOptions {
  format: ExportFormat;
  includeBackground: boolean;
  scale: number;
  includeNestedDiagrams: boolean;
  renderMode: RenderMode;
}

export interface PngExportOptions extends ExportOptions {
  format: 'png';
  embedScene: boolean;
  padding: number;
}

export interface SvgExportOptions extends ExportOptions {
  format: 'svg';
  padding: number;
}

export interface PdfExportOptions extends ExportOptions {
  format: 'pdf';
  multiPage: boolean;
  pageSize: 'a4' | 'letter' | 'auto';
}

// ---------------------------------------------------------------------------
// Client-side versioning
// ---------------------------------------------------------------------------

/** A version snapshot stored in IndexedDB. */
export interface VersionSnapshot {
  id: string;
  projectId: string;
  label: string;
  createdAt: number;
  isAutoSave: boolean;
  scene: MavisDrawScene;
  appState?: MavisDrawAppState;
  thumbnailDataUrl: string | null;
}

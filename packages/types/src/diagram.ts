export interface Layer {
  id: string;
  name: string;
  isVisible: boolean;
  isLocked: boolean;
  opacity: number;
  order: number;
}

export interface Diagram {
  id: string;
  projectId: string;
  parentDiagramId: string | null;
  parentPortalId: string | null;
  title: string;
  viewBackgroundColor: string;
  gridEnabled: boolean;
  gridSize: number;
  renderMode: import('./elements').RenderMode;
  layers: Layer[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface Viewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface Project {
  id: string;
  name: string;
  ownerId: string;
  rootDiagramId: string;
  isPublic: boolean;
  createdAt: number;
  updatedAt: number;
}

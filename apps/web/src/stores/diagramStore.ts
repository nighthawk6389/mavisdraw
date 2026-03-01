import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { Diagram, Layer, Viewport } from '@mavisdraw/types';

const ROOT_DIAGRAM_ID = 'root-diagram';

function createDefaultLayer(): Layer {
  return {
    id: nanoid(),
    name: 'Layer 1',
    isVisible: true,
    isLocked: false,
    opacity: 100,
    order: 0,
  };
}

function createDefaultDiagram(overrides: Partial<Diagram> = {}): Diagram {
  const now = Date.now();
  return {
    id: nanoid(),
    projectId: 'default-project',
    parentDiagramId: null,
    parentPortalId: null,
    title: 'Untitled Diagram',
    viewBackgroundColor: '#ffffff',
    gridEnabled: true,
    gridSize: 20,
    renderMode: 'sketchy',
    layers: [createDefaultLayer()],
    createdBy: 'local-user',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export interface DiagramTreeNode {
  diagram: Diagram;
  children: DiagramTreeNode[];
}

interface DiagramState {
  diagrams: Map<string, Diagram>;
  activeDiagramId: string;
  diagramPath: string[];
  viewportCache: Map<string, Viewport>;

  // Actions
  createDiagram: (
    parentDiagramId: string | null,
    parentPortalId: string | null,
    title: string,
  ) => Diagram;
  navigateToDiagram: (diagramId: string) => void;
  navigateUp: () => void;
  navigateToRoot: () => void;
  navigateToPathIndex: (index: number) => void;
  getDiagram: (id: string) => Diagram | undefined;
  getActiveDiagram: () => Diagram | undefined;
  getChildDiagrams: (parentId: string) => Diagram[];
  getDiagramTree: () => DiagramTreeNode[];
  updateDiagram: (id: string, updates: Partial<Diagram>) => void;
  deleteDiagram: (id: string) => void;
  saveViewport: (diagramId: string, viewport: Viewport) => void;
  getViewport: (diagramId: string) => Viewport | undefined;
}

/**
 * Compute the breadcrumb path from root to the given diagram.
 * Walks up the parentDiagramId chain and reverses.
 */
function computePath(diagrams: Map<string, Diagram>, targetId: string): string[] {
  const path: string[] = [];
  let currentId: string | null = targetId;
  while (currentId) {
    path.unshift(currentId);
    const diagram = diagrams.get(currentId);
    currentId = diagram?.parentDiagramId ?? null;
  }
  return path;
}

/**
 * Collect all descendant diagram IDs recursively.
 */
function collectDescendantIds(diagrams: Map<string, Diagram>, parentId: string): string[] {
  const result: string[] = [];
  for (const [id, diagram] of diagrams) {
    if (diagram.parentDiagramId === parentId) {
      result.push(id);
      result.push(...collectDescendantIds(diagrams, id));
    }
  }
  return result;
}

export function buildTreeForParent(
  diagrams: Map<string, Diagram>,
  parentId: string | null,
): DiagramTreeNode[] {
  const nodes: DiagramTreeNode[] = [];
  for (const diagram of diagrams.values()) {
    if (diagram.parentDiagramId === parentId) {
      nodes.push({
        diagram,
        children: buildTreeForParent(diagrams, diagram.id),
      });
    }
  }
  // Sort by creation time
  nodes.sort((a, b) => a.diagram.createdAt - b.diagram.createdAt);
  return nodes;
}

export const useDiagramStore = create<DiagramState>((set, get) => {
  // Initialize with a default root diagram
  const rootDiagram = createDefaultDiagram({
    id: ROOT_DIAGRAM_ID,
    title: 'Root Diagram',
  });

  const initialDiagrams = new Map<string, Diagram>();
  initialDiagrams.set(ROOT_DIAGRAM_ID, rootDiagram);

  return {
    diagrams: initialDiagrams,
    activeDiagramId: ROOT_DIAGRAM_ID,
    diagramPath: [ROOT_DIAGRAM_ID],
    viewportCache: new Map<string, Viewport>(),

    createDiagram: (
      parentDiagramId: string | null,
      parentPortalId: string | null,
      title: string,
    ): Diagram => {
      const diagram = createDefaultDiagram({
        parentDiagramId,
        parentPortalId,
        title,
      });

      set((prev) => {
        const next = new Map(prev.diagrams);
        next.set(diagram.id, diagram);
        return { diagrams: next };
      });

      return diagram;
    },

    navigateToDiagram: (diagramId: string) => {
      const state = get();
      const targetDiagram = state.diagrams.get(diagramId);
      if (!targetDiagram) return;

      // Compute the path from root to target
      const newPath = computePath(state.diagrams, diagramId);

      set({
        activeDiagramId: diagramId,
        diagramPath: newPath,
      });
    },

    navigateUp: () => {
      const state = get();
      if (state.diagramPath.length <= 1) return; // Already at root

      const parentId = state.diagramPath[state.diagramPath.length - 2];
      const newPath = state.diagramPath.slice(0, -1);

      set({
        activeDiagramId: parentId,
        diagramPath: newPath,
      });
    },

    navigateToRoot: () => {
      const state = get();
      const rootId = state.diagramPath[0];
      if (!rootId) return;

      set({
        activeDiagramId: rootId,
        diagramPath: [rootId],
      });
    },

    navigateToPathIndex: (index: number) => {
      const state = get();
      if (index < 0 || index >= state.diagramPath.length) return;

      const targetId = state.diagramPath[index];
      const newPath = state.diagramPath.slice(0, index + 1);

      set({
        activeDiagramId: targetId,
        diagramPath: newPath,
      });
    },

    getDiagram: (id: string) => {
      return get().diagrams.get(id);
    },

    getActiveDiagram: () => {
      const state = get();
      return state.diagrams.get(state.activeDiagramId);
    },

    getChildDiagrams: (parentId: string) => {
      const results: Diagram[] = [];
      for (const diagram of get().diagrams.values()) {
        if (diagram.parentDiagramId === parentId) {
          results.push(diagram);
        }
      }
      return results;
    },

    getDiagramTree: () => {
      return buildTreeForParent(get().diagrams, null);
    },

    updateDiagram: (id: string, updates: Partial<Diagram>) => {
      set((prev) => {
        const existing = prev.diagrams.get(id);
        if (!existing) return prev;

        const next = new Map(prev.diagrams);
        next.set(id, {
          ...existing,
          ...updates,
          updatedAt: Date.now(),
        });
        return { diagrams: next };
      });
    },

    deleteDiagram: (id: string) => {
      const state = get();
      // Don't delete root diagram
      if (state.diagramPath[0] === id) return;

      const descendantIds = collectDescendantIds(state.diagrams, id);
      const allIdsToDelete = [id, ...descendantIds];

      set((prev) => {
        const next = new Map(prev.diagrams);
        for (const deleteId of allIdsToDelete) {
          next.delete(deleteId);
        }

        // If the active diagram was deleted, navigate to parent or root
        let newActiveId = prev.activeDiagramId;
        let newPath = prev.diagramPath;
        if (allIdsToDelete.includes(prev.activeDiagramId)) {
          const deletedDiagram = prev.diagrams.get(id);
          newActiveId = deletedDiagram?.parentDiagramId ?? prev.diagramPath[0];
          newPath = computePath(next, newActiveId);
        }

        return {
          diagrams: next,
          activeDiagramId: newActiveId,
          diagramPath: newPath,
        };
      });
    },

    saveViewport: (diagramId: string, viewport: Viewport) => {
      set((prev) => {
        const next = new Map(prev.viewportCache);
        next.set(diagramId, { ...viewport });
        return { viewportCache: next };
      });
    },

    getViewport: (diagramId: string) => {
      return get().viewportCache.get(diagramId);
    },
  };
});

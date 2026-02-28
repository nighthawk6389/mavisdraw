import { describe, it, expect, beforeEach } from 'vitest';
import { useDiagramStore } from '../../stores/diagramStore';
import type { Viewport } from '@mavisdraw/types';

function resetStore() {
  // Re-initialize the store to its default state (root diagram only)
  const rootId = 'root-diagram';
  const state = useDiagramStore.getState();
  const rootDiagram = state.diagrams.get(rootId);

  const diagrams = new Map();
  if (rootDiagram) {
    diagrams.set(rootId, rootDiagram);
  }

  useDiagramStore.setState({
    diagrams,
    activeDiagramId: rootId,
    diagramPath: [rootId],
    viewportCache: new Map(),
  });
}

describe('diagramStore', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('initial state', () => {
    it('starts with a root diagram', () => {
      const state = useDiagramStore.getState();
      expect(state.diagrams.size).toBe(1);
      expect(state.activeDiagramId).toBe('root-diagram');
      expect(state.diagramPath).toEqual(['root-diagram']);
    });

    it('root diagram has correct properties', () => {
      const root = useDiagramStore.getState().getDiagram('root-diagram');
      expect(root).toBeDefined();
      expect(root!.title).toBe('Root Diagram');
      expect(root!.parentDiagramId).toBeNull();
      expect(root!.parentPortalId).toBeNull();
      expect(root!.layers.length).toBeGreaterThan(0);
    });
  });

  describe('createDiagram', () => {
    it('creates a new diagram with parent', () => {
      const diagram = useDiagramStore.getState().createDiagram(
        'root-diagram',
        'portal-1',
        'Child Diagram',
      );

      expect(diagram.id).toBeTruthy();
      expect(diagram.parentDiagramId).toBe('root-diagram');
      expect(diagram.parentPortalId).toBe('portal-1');
      expect(diagram.title).toBe('Child Diagram');
      expect(diagram.layers.length).toBe(1);

      // Should be in the store
      expect(useDiagramStore.getState().diagrams.get(diagram.id)).toBeDefined();
    });

    it('creates a diagram with null parent', () => {
      const diagram = useDiagramStore.getState().createDiagram(null, null, 'Orphan');
      expect(diagram.parentDiagramId).toBeNull();
      expect(diagram.parentPortalId).toBeNull();
    });

    it('assigns unique ids', () => {
      const d1 = useDiagramStore.getState().createDiagram('root-diagram', null, 'A');
      const d2 = useDiagramStore.getState().createDiagram('root-diagram', null, 'B');
      expect(d1.id).not.toBe(d2.id);
    });

    it('increments diagram count', () => {
      const sizeBefore = useDiagramStore.getState().diagrams.size;
      useDiagramStore.getState().createDiagram('root-diagram', null, 'New');
      expect(useDiagramStore.getState().diagrams.size).toBe(sizeBefore + 1);
    });
  });

  describe('navigateToDiagram', () => {
    it('navigates to a child diagram', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      useDiagramStore.getState().navigateToDiagram(child.id);

      const state = useDiagramStore.getState();
      expect(state.activeDiagramId).toBe(child.id);
      expect(state.diagramPath).toEqual(['root-diagram', child.id]);
    });

    it('navigates to a grandchild diagram', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      const grandchild = useDiagramStore.getState().createDiagram(child.id, null, 'Grandchild');
      useDiagramStore.getState().navigateToDiagram(grandchild.id);

      const state = useDiagramStore.getState();
      expect(state.activeDiagramId).toBe(grandchild.id);
      expect(state.diagramPath).toEqual(['root-diagram', child.id, grandchild.id]);
    });

    it('does nothing when navigating to non-existent diagram', () => {
      useDiagramStore.getState().navigateToDiagram('non-existent');
      expect(useDiagramStore.getState().activeDiagramId).toBe('root-diagram');
    });

    it('builds correct path when jumping directly to deep diagram', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      const grandchild = useDiagramStore.getState().createDiagram(child.id, null, 'Grandchild');
      const greatGrandchild = useDiagramStore.getState().createDiagram(
        grandchild.id,
        null,
        'Great Grandchild',
      );

      useDiagramStore.getState().navigateToDiagram(greatGrandchild.id);
      expect(useDiagramStore.getState().diagramPath).toEqual([
        'root-diagram',
        child.id,
        grandchild.id,
        greatGrandchild.id,
      ]);
    });
  });

  describe('navigateUp', () => {
    it('navigates up to parent', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      useDiagramStore.getState().navigateToDiagram(child.id);
      useDiagramStore.getState().navigateUp();

      expect(useDiagramStore.getState().activeDiagramId).toBe('root-diagram');
      expect(useDiagramStore.getState().diagramPath).toEqual(['root-diagram']);
    });

    it('does nothing at root', () => {
      useDiagramStore.getState().navigateUp();
      expect(useDiagramStore.getState().activeDiagramId).toBe('root-diagram');
      expect(useDiagramStore.getState().diagramPath).toEqual(['root-diagram']);
    });

    it('navigates up one level from grandchild', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      const grandchild = useDiagramStore.getState().createDiagram(child.id, null, 'Grandchild');
      useDiagramStore.getState().navigateToDiagram(grandchild.id);
      useDiagramStore.getState().navigateUp();

      expect(useDiagramStore.getState().activeDiagramId).toBe(child.id);
      expect(useDiagramStore.getState().diagramPath).toEqual(['root-diagram', child.id]);
    });
  });

  describe('navigateToRoot', () => {
    it('navigates back to root from any depth', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      const grandchild = useDiagramStore.getState().createDiagram(child.id, null, 'Grandchild');
      useDiagramStore.getState().navigateToDiagram(grandchild.id);
      useDiagramStore.getState().navigateToRoot();

      expect(useDiagramStore.getState().activeDiagramId).toBe('root-diagram');
      expect(useDiagramStore.getState().diagramPath).toEqual(['root-diagram']);
    });

    it('does nothing when already at root', () => {
      useDiagramStore.getState().navigateToRoot();
      expect(useDiagramStore.getState().activeDiagramId).toBe('root-diagram');
    });
  });

  describe('navigateToPathIndex', () => {
    it('navigates to specific breadcrumb position', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      const grandchild = useDiagramStore.getState().createDiagram(child.id, null, 'Grandchild');
      useDiagramStore.getState().navigateToDiagram(grandchild.id);

      // Navigate to index 1 (child)
      useDiagramStore.getState().navigateToPathIndex(1);
      expect(useDiagramStore.getState().activeDiagramId).toBe(child.id);
      expect(useDiagramStore.getState().diagramPath).toEqual(['root-diagram', child.id]);
    });

    it('navigates to root at index 0', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      useDiagramStore.getState().navigateToDiagram(child.id);

      useDiagramStore.getState().navigateToPathIndex(0);
      expect(useDiagramStore.getState().activeDiagramId).toBe('root-diagram');
    });

    it('does nothing for invalid index', () => {
      useDiagramStore.getState().navigateToPathIndex(-1);
      expect(useDiagramStore.getState().activeDiagramId).toBe('root-diagram');

      useDiagramStore.getState().navigateToPathIndex(5);
      expect(useDiagramStore.getState().activeDiagramId).toBe('root-diagram');
    });
  });

  describe('getDiagram', () => {
    it('returns diagram by id', () => {
      const diagram = useDiagramStore.getState().getDiagram('root-diagram');
      expect(diagram).toBeDefined();
      expect(diagram!.title).toBe('Root Diagram');
    });

    it('returns undefined for non-existent id', () => {
      expect(useDiagramStore.getState().getDiagram('non-existent')).toBeUndefined();
    });
  });

  describe('getActiveDiagram', () => {
    it('returns the currently active diagram', () => {
      const active = useDiagramStore.getState().getActiveDiagram();
      expect(active).toBeDefined();
      expect(active!.id).toBe('root-diagram');
    });

    it('returns correct diagram after navigation', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      useDiagramStore.getState().navigateToDiagram(child.id);
      const active = useDiagramStore.getState().getActiveDiagram();
      expect(active!.id).toBe(child.id);
    });
  });

  describe('getChildDiagrams', () => {
    it('returns children of a parent', () => {
      useDiagramStore.getState().createDiagram('root-diagram', null, 'Child A');
      useDiagramStore.getState().createDiagram('root-diagram', null, 'Child B');

      const children = useDiagramStore.getState().getChildDiagrams('root-diagram');
      expect(children.length).toBe(2);
    });

    it('returns empty array for diagrams with no children', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      const children = useDiagramStore.getState().getChildDiagrams(child.id);
      expect(children.length).toBe(0);
    });

    it('only returns direct children', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      useDiagramStore.getState().createDiagram(child.id, null, 'Grandchild');

      const rootChildren = useDiagramStore.getState().getChildDiagrams('root-diagram');
      expect(rootChildren.length).toBe(1);
      expect(rootChildren[0].id).toBe(child.id);
    });
  });

  describe('getDiagramTree', () => {
    it('returns tree with root', () => {
      const tree = useDiagramStore.getState().getDiagramTree();
      expect(tree.length).toBe(1);
      expect(tree[0].diagram.id).toBe('root-diagram');
      expect(tree[0].children.length).toBe(0);
    });

    it('returns nested tree structure', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      useDiagramStore.getState().createDiagram(child.id, null, 'Grandchild');

      const tree = useDiagramStore.getState().getDiagramTree();
      expect(tree.length).toBe(1);
      expect(tree[0].children.length).toBe(1);
      expect(tree[0].children[0].diagram.title).toBe('Child');
      expect(tree[0].children[0].children.length).toBe(1);
      expect(tree[0].children[0].children[0].diagram.title).toBe('Grandchild');
    });
  });

  describe('updateDiagram', () => {
    it('updates diagram properties', () => {
      useDiagramStore.getState().updateDiagram('root-diagram', { title: 'Updated Title' });
      const diagram = useDiagramStore.getState().getDiagram('root-diagram');
      expect(diagram!.title).toBe('Updated Title');
    });

    it('updates the updatedAt timestamp', () => {
      const before = useDiagramStore.getState().getDiagram('root-diagram')!.updatedAt;
      // Small delay to ensure timestamp changes
      useDiagramStore.getState().updateDiagram('root-diagram', { title: 'New' });
      const after = useDiagramStore.getState().getDiagram('root-diagram')!.updatedAt;
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it('does nothing for non-existent id', () => {
      const sizeBefore = useDiagramStore.getState().diagrams.size;
      useDiagramStore.getState().updateDiagram('non-existent', { title: 'X' });
      expect(useDiagramStore.getState().diagrams.size).toBe(sizeBefore);
    });
  });

  describe('deleteDiagram', () => {
    it('deletes a child diagram', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      expect(useDiagramStore.getState().diagrams.size).toBe(2);

      useDiagramStore.getState().deleteDiagram(child.id);
      expect(useDiagramStore.getState().diagrams.size).toBe(1);
      expect(useDiagramStore.getState().getDiagram(child.id)).toBeUndefined();
    });

    it('does not delete the root diagram', () => {
      useDiagramStore.getState().deleteDiagram('root-diagram');
      expect(useDiagramStore.getState().diagrams.size).toBe(1);
      expect(useDiagramStore.getState().getDiagram('root-diagram')).toBeDefined();
    });

    it('recursively deletes descendants', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      const grandchild = useDiagramStore.getState().createDiagram(child.id, null, 'Grandchild');
      expect(useDiagramStore.getState().diagrams.size).toBe(3);

      useDiagramStore.getState().deleteDiagram(child.id);
      expect(useDiagramStore.getState().diagrams.size).toBe(1);
      expect(useDiagramStore.getState().getDiagram(child.id)).toBeUndefined();
      expect(useDiagramStore.getState().getDiagram(grandchild.id)).toBeUndefined();
    });

    it('navigates to parent when deleting active diagram', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
      useDiagramStore.getState().navigateToDiagram(child.id);
      expect(useDiagramStore.getState().activeDiagramId).toBe(child.id);

      useDiagramStore.getState().deleteDiagram(child.id);
      expect(useDiagramStore.getState().activeDiagramId).toBe('root-diagram');
    });
  });

  describe('viewport caching', () => {
    it('saves and retrieves viewport', () => {
      const viewport: Viewport = { scrollX: 100, scrollY: 200, zoom: 1.5 };
      useDiagramStore.getState().saveViewport('root-diagram', viewport);

      const cached = useDiagramStore.getState().getViewport('root-diagram');
      expect(cached).toEqual(viewport);
    });

    it('returns undefined for uncached viewport', () => {
      expect(useDiagramStore.getState().getViewport('non-existent')).toBeUndefined();
    });

    it('caches viewports independently per diagram', () => {
      const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');

      const vp1: Viewport = { scrollX: 10, scrollY: 20, zoom: 1 };
      const vp2: Viewport = { scrollX: 30, scrollY: 40, zoom: 2 };

      useDiagramStore.getState().saveViewport('root-diagram', vp1);
      useDiagramStore.getState().saveViewport(child.id, vp2);

      expect(useDiagramStore.getState().getViewport('root-diagram')).toEqual(vp1);
      expect(useDiagramStore.getState().getViewport(child.id)).toEqual(vp2);
    });

    it('overwrites cached viewport on re-save', () => {
      const vp1: Viewport = { scrollX: 10, scrollY: 20, zoom: 1 };
      const vp2: Viewport = { scrollX: 30, scrollY: 40, zoom: 2 };

      useDiagramStore.getState().saveViewport('root-diagram', vp1);
      useDiagramStore.getState().saveViewport('root-diagram', vp2);

      expect(useDiagramStore.getState().getViewport('root-diagram')).toEqual(vp2);
    });
  });
});

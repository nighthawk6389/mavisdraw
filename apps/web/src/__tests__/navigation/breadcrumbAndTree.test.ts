import { describe, it, expect, beforeEach } from 'vitest';
import { useDiagramStore } from '../../stores/diagramStore';
import type { DiagramTreeNode } from '../../stores/diagramStore';

function resetStore() {
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

describe('breadcrumb path management', () => {
  beforeEach(() => {
    resetStore();
  });

  it('path is just root initially', () => {
    expect(useDiagramStore.getState().diagramPath).toEqual(['root-diagram']);
  });

  it('path updates correctly when navigating to child', () => {
    const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
    useDiagramStore.getState().navigateToDiagram(child.id);
    expect(useDiagramStore.getState().diagramPath).toEqual(['root-diagram', child.id]);
  });

  it('path updates correctly when navigating to grandchild', () => {
    const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
    const grandchild = useDiagramStore.getState().createDiagram(child.id, null, 'Grandchild');
    useDiagramStore.getState().navigateToDiagram(grandchild.id);
    expect(useDiagramStore.getState().diagramPath).toEqual([
      'root-diagram',
      child.id,
      grandchild.id,
    ]);
  });

  it('clicking a breadcrumb segment truncates the path', () => {
    const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
    const grandchild = useDiagramStore.getState().createDiagram(child.id, null, 'Grandchild');
    useDiagramStore.getState().navigateToDiagram(grandchild.id);

    // Click on index 0 (root)
    useDiagramStore.getState().navigateToPathIndex(0);
    expect(useDiagramStore.getState().diagramPath).toEqual(['root-diagram']);
    expect(useDiagramStore.getState().activeDiagramId).toBe('root-diagram');
  });

  it('navigateUp shortens the path by one', () => {
    const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
    const grandchild = useDiagramStore.getState().createDiagram(child.id, null, 'Grandchild');
    useDiagramStore.getState().navigateToDiagram(grandchild.id);

    useDiagramStore.getState().navigateUp();
    expect(useDiagramStore.getState().diagramPath).toEqual(['root-diagram', child.id]);
    expect(useDiagramStore.getState().activeDiagramId).toBe(child.id);
  });

  it('navigateToRoot collapses entire path', () => {
    const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
    const grandchild = useDiagramStore.getState().createDiagram(child.id, null, 'Grandchild');
    useDiagramStore.getState().navigateToDiagram(grandchild.id);

    useDiagramStore.getState().navigateToRoot();
    expect(useDiagramStore.getState().diagramPath).toEqual(['root-diagram']);
  });

  it('navigateToPathIndex at current position does nothing meaningful', () => {
    const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Child');
    useDiagramStore.getState().navigateToDiagram(child.id);

    const pathBefore = [...useDiagramStore.getState().diagramPath];
    useDiagramStore.getState().navigateToPathIndex(1);
    expect(useDiagramStore.getState().diagramPath).toEqual(pathBefore);
  });

  it('diagram names are retrievable from path IDs', () => {
    const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Alpha');
    const grandchild = useDiagramStore.getState().createDiagram(child.id, null, 'Beta');
    useDiagramStore.getState().navigateToDiagram(grandchild.id);

    const path = useDiagramStore.getState().diagramPath;
    const names = path.map((id) => useDiagramStore.getState().getDiagram(id)?.title);
    expect(names).toEqual(['Root Diagram', 'Alpha', 'Beta']);
  });
});

describe('diagram tree hierarchy', () => {
  beforeEach(() => {
    resetStore();
  });

  it('tree has single root node initially', () => {
    const tree = useDiagramStore.getState().getDiagramTree();
    expect(tree.length).toBe(1);
    expect(tree[0].diagram.id).toBe('root-diagram');
    expect(tree[0].children.length).toBe(0);
  });

  it('tree includes children under correct parent', () => {
    useDiagramStore.getState().createDiagram('root-diagram', null, 'Child A');
    useDiagramStore.getState().createDiagram('root-diagram', null, 'Child B');

    const tree = useDiagramStore.getState().getDiagramTree();
    expect(tree[0].children.length).toBe(2);
    const titles = tree[0].children.map((c: DiagramTreeNode) => c.diagram.title);
    expect(titles).toContain('Child A');
    expect(titles).toContain('Child B');
  });

  it('tree is nested correctly at multiple levels', () => {
    const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Level 1');
    const grandchild = useDiagramStore.getState().createDiagram(child.id, null, 'Level 2');
    useDiagramStore.getState().createDiagram(grandchild.id, null, 'Level 3');

    const tree = useDiagramStore.getState().getDiagramTree();
    expect(tree[0].children.length).toBe(1);
    expect(tree[0].children[0].children.length).toBe(1);
    expect(tree[0].children[0].children[0].children.length).toBe(1);
    expect(tree[0].children[0].children[0].children[0].diagram.title).toBe('Level 3');
  });

  it('deleting a diagram removes it from the tree', () => {
    const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Deletable');
    const tree1 = useDiagramStore.getState().getDiagramTree();
    expect(tree1[0].children.length).toBe(1);

    useDiagramStore.getState().deleteDiagram(child.id);
    const tree2 = useDiagramStore.getState().getDiagramTree();
    expect(tree2[0].children.length).toBe(0);
  });

  it('deleting a parent removes all descendants from tree', () => {
    const child = useDiagramStore.getState().createDiagram('root-diagram', null, 'Parent');
    useDiagramStore.getState().createDiagram(child.id, null, 'Grandchild');

    useDiagramStore.getState().deleteDiagram(child.id);
    const tree = useDiagramStore.getState().getDiagramTree();
    expect(tree[0].children.length).toBe(0);
    expect(useDiagramStore.getState().diagrams.size).toBe(1); // Only root left
  });

  it('tree structure is correct with siblings at multiple levels', () => {
    const c1 = useDiagramStore.getState().createDiagram('root-diagram', null, 'C1');
    const c2 = useDiagramStore.getState().createDiagram('root-diagram', null, 'C2');
    useDiagramStore.getState().createDiagram(c1.id, null, 'C1-A');
    useDiagramStore.getState().createDiagram(c1.id, null, 'C1-B');
    useDiagramStore.getState().createDiagram(c2.id, null, 'C2-A');

    const tree = useDiagramStore.getState().getDiagramTree();
    expect(tree[0].children.length).toBe(2);

    const c1Node = tree[0].children.find(
      (c: DiagramTreeNode) => c.diagram.title === 'C1',
    )!;
    const c2Node = tree[0].children.find(
      (c: DiagramTreeNode) => c.diagram.title === 'C2',
    )!;

    expect(c1Node.children.length).toBe(2);
    expect(c2Node.children.length).toBe(1);
  });
});

describe('uiStore diagram tree toggle', () => {
  it('showDiagramTree defaults to false', async () => {
    const { useUIStore } = await import('../../stores/uiStore');
    // Reset to default
    useUIStore.setState({ showDiagramTree: false });
    expect(useUIStore.getState().showDiagramTree).toBe(false);
  });

  it('toggleDiagramTree toggles the flag', async () => {
    const { useUIStore } = await import('../../stores/uiStore');
    useUIStore.setState({ showDiagramTree: false });

    useUIStore.getState().toggleDiagramTree();
    expect(useUIStore.getState().showDiagramTree).toBe(true);

    useUIStore.getState().toggleDiagramTree();
    expect(useUIStore.getState().showDiagramTree).toBe(false);
  });
});

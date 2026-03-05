import { describe, it, expect, beforeEach } from 'vitest';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import type { PortalElement } from '@mavisdraw/types';

function resetStores() {
  useElementsStore.setState({
    elements: new Map(),
    history: [],
    historyIndex: -1,
  });

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

describe('portal creation flow', () => {
  beforeEach(() => {
    resetStores();
  });

  it('creates a portal element with correct defaults', () => {
    const el = useElementsStore.getState().createElement(
      'portal',
      'root-diagram',
      10,
      20,
      120,
      100,
    );

    expect(el.type).toBe('portal');
    if (el.type === 'portal') {
      expect(el.label).toBe('Portal');
      expect(el.portalStyle).toBe('card');
      expect(el.targetDiagramId).toBe('');
      expect(el.thumbnailDataUrl).toBeNull();
    }
  });

  it('links portal to a new child diagram', () => {
    const store = useElementsStore.getState();
    const portal = store.createElement('portal', 'root-diagram', 0, 0, 100, 80);
    store.addElement(portal);

    // Create child diagram
    const diagram = useDiagramStore.getState().createDiagram(
      'root-diagram',
      portal.id,
      portal.type === 'portal' ? (portal as PortalElement).label : 'Portal',
    );

    // Link portal to diagram
    useElementsStore.getState().updateElement(portal.id, {
      targetDiagramId: diagram.id,
    } as Partial<PortalElement>);

    const updated = useElementsStore.getState().getElementById(portal.id) as PortalElement;
    expect(updated.targetDiagramId).toBe(diagram.id);
    expect(diagram.parentDiagramId).toBe('root-diagram');
    expect(diagram.parentPortalId).toBe(portal.id);
  });

  it('updates portal label', () => {
    const store = useElementsStore.getState();
    const portal = store.createElement('portal', 'root-diagram', 0, 0, 100, 80);
    store.addElement(portal);

    useElementsStore.getState().updateElement(portal.id, {
      label: 'My Sub-Diagram',
    } as Partial<PortalElement>);

    const updated = useElementsStore.getState().getElementById(portal.id) as PortalElement;
    expect(updated.label).toBe('My Sub-Diagram');
  });

  it('updates portal style', () => {
    const store = useElementsStore.getState();
    const portal = store.createElement('portal', 'root-diagram', 0, 0, 100, 80);
    store.addElement(portal);

    useElementsStore.getState().updateElement(portal.id, {
      portalStyle: 'badge',
    } as Partial<PortalElement>);

    const updated = useElementsStore.getState().getElementById(portal.id) as PortalElement;
    expect(updated.portalStyle).toBe('badge');
  });

  it('creates a portal with githubLink defaulting to null', () => {
    const el = useElementsStore.getState().createElement(
      'portal',
      'root-diagram',
      10,
      20,
      120,
      100,
    );

    expect(el.type).toBe('portal');
    if (el.type === 'portal') {
      expect((el as PortalElement).githubLink).toBeNull();
    }
  });

  it('links and unlinks a GitHub repo on a portal', () => {
    const store = useElementsStore.getState();
    const portal = store.createElement('portal', 'root-diagram', 0, 0, 100, 80);
    store.addElement(portal);

    // Link GitHub repo
    useElementsStore.getState().updateElement(portal.id, {
      githubLink: {
        owner: 'acme',
        repo: 'api-gateway',
        path: 'src/',
        ref: 'main',
      },
    } as Partial<PortalElement>);

    const linked = useElementsStore.getState().getElementById(portal.id) as PortalElement;
    expect(linked.githubLink).toEqual({
      owner: 'acme',
      repo: 'api-gateway',
      path: 'src/',
      ref: 'main',
    });

    // Unlink
    useElementsStore.getState().updateElement(portal.id, {
      githubLink: null,
    } as Partial<PortalElement>);

    const unlinked = useElementsStore.getState().getElementById(portal.id) as PortalElement;
    expect(unlinked.githubLink).toBeNull();
  });

  it('portal can have both targetDiagramId and githubLink', () => {
    const store = useElementsStore.getState();
    const portal = store.createElement('portal', 'root-diagram', 0, 0, 100, 80);
    store.addElement(portal);

    useElementsStore.getState().updateElement(portal.id, {
      targetDiagramId: 'child-diagram',
      githubLink: {
        owner: 'acme',
        repo: 'user-service',
        path: '',
        ref: 'develop',
      },
    } as Partial<PortalElement>);

    const updated = useElementsStore.getState().getElementById(portal.id) as PortalElement;
    expect(updated.targetDiagramId).toBe('child-diagram');
    expect(updated.githubLink).toEqual({
      owner: 'acme',
      repo: 'user-service',
      path: '',
      ref: 'develop',
    });
  });

  it('detaches portal from diagram', () => {
    const store = useElementsStore.getState();
    const portal = store.createElement('portal', 'root-diagram', 0, 0, 100, 80);
    store.addElement(portal);

    // Link
    useElementsStore.getState().updateElement(portal.id, {
      targetDiagramId: 'some-diagram-id',
    } as Partial<PortalElement>);

    // Detach
    useElementsStore.getState().updateElement(portal.id, {
      targetDiagramId: '',
      thumbnailDataUrl: null,
    } as Partial<PortalElement>);

    const updated = useElementsStore.getState().getElementById(portal.id) as PortalElement;
    expect(updated.targetDiagramId).toBe('');
    expect(updated.thumbnailDataUrl).toBeNull();
  });
});

describe('elements scoping by diagram', () => {
  beforeEach(() => {
    resetStores();
  });

  it('getVisibleElements returns only elements for the given diagram', () => {
    const store = useElementsStore.getState();

    const el1 = store.createElement('rectangle', 'root-diagram', 0, 0, 50, 50);
    store.addElement(el1);

    const el2 = useElementsStore.getState().createElement('rectangle', 'child-diagram', 10, 10, 50, 50);
    useElementsStore.getState().addElement(el2);

    const rootElements = useElementsStore.getState().getVisibleElements('root-diagram');
    const childElements = useElementsStore.getState().getVisibleElements('child-diagram');

    expect(rootElements.length).toBe(1);
    expect(rootElements[0].id).toBe(el1.id);
    expect(childElements.length).toBe(1);
    expect(childElements[0].id).toBe(el2.id);
  });

  it('getVisibleElements excludes deleted elements', () => {
    const store = useElementsStore.getState();
    const el1 = store.createElement('rectangle', 'root-diagram', 0, 0, 50, 50);
    const el2 = store.createElement('rectangle', 'root-diagram', 10, 10, 50, 50);
    store.addElement(el1);
    useElementsStore.getState().addElement(el2);
    useElementsStore.getState().deleteElement(el1.id);

    const visible = useElementsStore.getState().getVisibleElements('root-diagram');
    expect(visible.length).toBe(1);
    expect(visible[0].id).toBe(el2.id);
  });

  it('getElementsByDiagram includes deleted elements', () => {
    const store = useElementsStore.getState();
    const el1 = store.createElement('rectangle', 'root-diagram', 0, 0, 50, 50);
    store.addElement(el1);
    useElementsStore.getState().deleteElement(el1.id);

    const all = useElementsStore.getState().getElementsByDiagram('root-diagram');
    expect(all.length).toBe(1);
    expect(all[0].isDeleted).toBe(true);
  });

  it('createElement assigns the given diagramId', () => {
    const el = useElementsStore.getState().createElement('ellipse', 'my-diagram', 0, 0, 50, 50);
    expect(el.diagramId).toBe('my-diagram');
  });

  it('elements from different diagrams do not interfere', () => {
    const store = useElementsStore.getState();

    // Add elements to two different diagrams
    for (let i = 0; i < 5; i++) {
      const el = store.createElement('rectangle', 'diagram-a', i * 10, 0, 10, 10);
      useElementsStore.getState().addElement(el);
    }
    for (let i = 0; i < 3; i++) {
      const el = useElementsStore.getState().createElement('ellipse', 'diagram-b', i * 10, 0, 10, 10);
      useElementsStore.getState().addElement(el);
    }

    expect(useElementsStore.getState().getVisibleElements('diagram-a').length).toBe(5);
    expect(useElementsStore.getState().getVisibleElements('diagram-b').length).toBe(3);
    expect(useElementsStore.getState().getVisibleElements('diagram-c').length).toBe(0);
  });
});

import type { MavisDrawScene, MavisElement } from '@mavisdraw/types';

/** Small scene builders for tests that need a nested architecture map. */

const base = {
  angle: 0,
  opacity: 100,
  strokeColor: '#000',
  backgroundColor: 'transparent',
  fillStyle: 'none',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 1,
  seed: 1,
  renderMode: 'clean',
  layerId: 'default',
  groupIds: [],
  isLocked: false,
  isDeleted: false,
  boundElements: [],
  version: 1,
  updatedAt: 1,
  x: 0,
  y: 0,
  width: 100,
  height: 50,
};

export const diagram = (id: string, title: string, parentDiagramId: string | null = null) => ({
  id,
  projectId: 'p',
  parentDiagramId,
  parentPortalId: null,
  title,
  viewBackgroundColor: '#fff',
  gridEnabled: true,
  gridSize: 20,
  renderMode: 'clean' as const,
  layers: [],
  createdBy: 'u',
  createdAt: 1,
  updatedAt: 1,
});

export function box(id: string, label: string, diagramId = 'root'): MavisElement[] {
  return [
    {
      ...base,
      id,
      diagramId,
      type: 'rectangle',
      roundness: 0,
      boundElements: [{ id: `${id}-t`, type: 'text' }],
    },
    {
      ...base,
      id: `${id}-t`,
      diagramId,
      type: 'text',
      text: label,
      containerId: id,
      fontSize: 16,
      fontFamily: 'x',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.25,
    },
  ] as unknown as MavisElement[];
}

export function portal(
  id: string,
  label: string,
  target: string,
  codePath: string | null,
  diagramId = 'root',
): MavisElement {
  return {
    ...base,
    id,
    diagramId,
    type: 'portal',
    label,
    targetDiagramId: target,
    thumbnailDataUrl: null,
    portalStyle: 'card',
    githubLink: null,
    codePath,
  } as unknown as MavisElement;
}

export function arrow(id: string, from: string, to: string, diagramId = 'root'): MavisElement {
  return {
    ...base,
    id,
    diagramId,
    type: 'arrow',
    points: [
      [0, 0],
      [10, 0],
    ],
    startBinding: { elementId: from, gap: 0 },
    endBinding: { elementId: to, gap: 0 },
    routingMode: 'straight',
    startArrowhead: null,
    endArrowhead: 'arrow',
  } as unknown as MavisElement;
}

/** Shop: Web App → API (drills into API: Auth Service, Orders) → Orders DB. */
export function shopScene(): MavisDrawScene {
  return {
    rootDiagramId: 'root',
    diagrams: [diagram('root', 'Shop'), diagram('api-d', 'API internals', 'root')],
    elements: [
      ...box('web', 'Web App'),
      portal('api', 'API', 'api-d', 'apps/api'),
      ...box('db', 'Orders DB'),
      arrow('a1', 'web', 'api'),
      arrow('a2', 'api', 'db'),
      portal('auth', 'Auth Service', 'auth-d', 'apps/api/src/auth', 'api-d'),
      ...box('orders', 'Orders', 'api-d'),
    ],
  };
}

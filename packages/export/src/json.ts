import type {
  Diagram,
  MavisElement,
  MavisDrawFile,
  MavisDrawAppState,
  MavisDrawScene,
} from '@mavisdraw/types';

const CURRENT_FILE_VERSION = 1;
const APP_VERSION = '0.1.0';

/**
 * Serialize diagrams and elements into a .mavisdraw JSON file.
 * Filters out soft-deleted elements (isDeleted: true).
 */
export function exportToMavisDrawFile(
  diagrams: Diagram[],
  elements: MavisElement[],
  rootDiagramId: string,
  appState?: MavisDrawAppState,
): MavisDrawFile {
  const liveElements = elements.filter((el) => !el.isDeleted);

  return {
    type: 'mavisdraw',
    version: CURRENT_FILE_VERSION,
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    scene: {
      diagrams,
      elements: liveElements,
      rootDiagramId,
    },
    ...(appState ? { appState } : {}),
  };
}

/**
 * Parse and validate a .mavisdraw JSON string.
 * Throws on invalid format.
 */
export function importMavisDrawFile(jsonString: string): {
  diagrams: Diagram[];
  elements: MavisElement[];
  rootDiagramId: string;
  appState?: MavisDrawAppState;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error('Invalid JSON: failed to parse .mavisdraw file');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid .mavisdraw file: expected an object');
  }

  const file = parsed as Record<string, unknown>;

  if (file.type !== 'mavisdraw') {
    throw new Error(`Invalid .mavisdraw file: expected type "mavisdraw", got "${file.type}"`);
  }

  if (typeof file.version !== 'number' || file.version > CURRENT_FILE_VERSION) {
    throw new Error(
      `Unsupported .mavisdraw file version: ${file.version}. ` +
        `This app supports up to version ${CURRENT_FILE_VERSION}.`,
    );
  }

  const scene = file.scene as MavisDrawScene | undefined;
  if (!scene || !Array.isArray(scene.diagrams) || !Array.isArray(scene.elements)) {
    throw new Error('Invalid .mavisdraw file: missing or invalid scene data');
  }

  if (typeof scene.rootDiagramId !== 'string') {
    throw new Error('Invalid .mavisdraw file: missing rootDiagramId');
  }

  return {
    diagrams: scene.diagrams,
    elements: scene.elements,
    rootDiagramId: scene.rootDiagramId,
    appState: file.appState as MavisDrawAppState | undefined,
  };
}

/**
 * Create a downloadable Blob from a MavisDrawFile.
 */
export function createMavisDrawBlob(file: MavisDrawFile): Blob {
  const json = JSON.stringify(file, null, 2);
  return new Blob([json], { type: 'application/json' });
}

import { create } from 'zustand';
import type { VersionSnapshot } from '@mavisdraw/types';
import {
  saveSnapshot as dbSaveSnapshot,
  getSnapshotsByProject,
  getSnapshot as dbGetSnapshot,
  deleteSnapshotById,
  pruneSnapshots,
} from '../utils/versionDb';
import { useElementsStore } from './elementsStore';
import { useDiagramStore } from './diagramStore';
import { useUIStore } from './uiStore';

const MAX_AUTO_SNAPSHOTS = 50;
const MAX_AUTO_SNAPSHOT_AGE = 90 * 24 * 60 * 60 * 1000; // 90 days

let snapshotCounter = 0;
function generateSnapshotId(): string {
  return `snap-${Date.now()}-${++snapshotCounter}`;
}

interface VersionState {
  snapshots: VersionSnapshot[];
  isLoading: boolean;

  initialize: (projectId: string) => Promise<void>;
  saveSnapshot: (label: string) => Promise<void>;
  autoSnapshot: () => Promise<void>;
  restoreSnapshot: (snapshotId: string) => Promise<void>;
  deleteSnapshot: (snapshotId: string) => Promise<void>;
}

export const useVersionStore = create<VersionState>((set, get) => ({
  snapshots: [],
  isLoading: false,

  initialize: async (projectId: string) => {
    set({ isLoading: true });
    try {
      const snapshots = await getSnapshotsByProject(projectId);
      set({ snapshots, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  saveSnapshot: async (label: string) => {
    const elementsMap = useElementsStore.getState().elements;
    const diagrams = Array.from(useDiagramStore.getState().diagrams.values());
    const rootDiagramId = useDiagramStore.getState().diagramPath[0] || 'root-diagram';
    const uiState = useUIStore.getState();

    const elements = Array.from(elementsMap.values()).filter((el) => !el.isDeleted);
    const projectId = diagrams[0]?.projectId || 'default';

    const snapshot: VersionSnapshot = {
      id: generateSnapshotId(),
      projectId,
      label,
      createdAt: Date.now(),
      isAutoSave: false,
      scene: {
        diagrams,
        elements,
        rootDiagramId,
      },
      appState: {
        renderMode: uiState.renderMode,
        viewBackgroundColor: '#ffffff',
        gridEnabled: uiState.showGrid,
        gridSize: uiState.gridSize,
      },
      thumbnailDataUrl: null,
    };

    await dbSaveSnapshot(snapshot);
    set((state) => ({ snapshots: [snapshot, ...state.snapshots] }));
  },

  autoSnapshot: async () => {
    const elementsMap = useElementsStore.getState().elements;
    const diagrams = Array.from(useDiagramStore.getState().diagrams.values());
    const rootDiagramId = useDiagramStore.getState().diagramPath[0] || 'root-diagram';
    const uiState = useUIStore.getState();

    const elements = Array.from(elementsMap.values()).filter((el) => !el.isDeleted);
    if (elements.length === 0) return;

    const projectId = diagrams[0]?.projectId || 'default';

    const snapshot: VersionSnapshot = {
      id: generateSnapshotId(),
      projectId,
      label: 'Auto-save',
      createdAt: Date.now(),
      isAutoSave: true,
      scene: {
        diagrams,
        elements,
        rootDiagramId,
      },
      appState: {
        renderMode: uiState.renderMode,
        viewBackgroundColor: '#ffffff',
        gridEnabled: uiState.showGrid,
        gridSize: uiState.gridSize,
      },
      thumbnailDataUrl: null,
    };

    await dbSaveSnapshot(snapshot);
    set((state) => ({ snapshots: [snapshot, ...state.snapshots] }));

    // Prune old auto-saves
    await pruneSnapshots(projectId, MAX_AUTO_SNAPSHOT_AGE, MAX_AUTO_SNAPSHOTS);
  },

  restoreSnapshot: async (snapshotId: string) => {
    const snapshot = await dbGetSnapshot(snapshotId);
    if (!snapshot) return;

    // Create safety snapshot before restoring
    await get().saveSnapshot('Before restore');

    // Push current state to history so restore is undoable
    useElementsStore.getState().pushHistory();

    // Load elements
    useElementsStore.getState().setElements(snapshot.scene.elements);

    // Load diagrams
    const diagStore = useDiagramStore.getState();
    const newDiagrams = new Map(snapshot.scene.diagrams.map((d) => [d.id, d]));
    // We need to set diagrams directly — use a simple approach
    for (const [id, diagram] of newDiagrams) {
      if (!diagStore.diagrams.has(id)) {
        diagStore.createDiagram(
          diagram.parentDiagramId,
          diagram.parentPortalId,
          diagram.title,
        );
      }
    }

    // Navigate to root
    if (snapshot.scene.rootDiagramId) {
      diagStore.navigateToDiagram(snapshot.scene.rootDiagramId);
    }
  },

  deleteSnapshot: async (snapshotId: string) => {
    await deleteSnapshotById(snapshotId);
    set((state) => ({
      snapshots: state.snapshots.filter((s) => s.id !== snapshotId),
    }));
  },
}));

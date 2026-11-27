import { create } from 'zustand';
import {
  apiGetPresentation,
  apiGetTour,
  apiSaveTour,
  apiSetPresentation,
  type PresentationState,
  type TourStop,
} from '../services/api';
import { useDiagramStore } from './diagramStore';
import { useElementsStore } from './elementsStore';
import { useAuthStore } from './authStore';
import { useSelectionStore } from './selectionStore';
import { useCommentsStore } from './commentsStore';
import { ensureDiagramKnown, loadDiagramElements } from '../services/diagramSync';
import { getCanvasController } from '../components/canvas/canvasController';
import { generateTour, stopId } from '../present/tour';
import { toast } from './toastStore';

interface PresentState {
  stops: TourStop[];
  panelOpen: boolean;
  /** This user is presenting. */
  presenting: boolean;
  index: number;
  /** Someone else's presentation, if one is running. */
  remote: PresentationState | null;
  /** Following that presentation (their stops drive this screen). */
  following: boolean;

  loadTour: () => Promise<void>;
  setPanelOpen: (open: boolean) => void;
  addCurrentView: () => void;
  updateStop: (id: string, patch: Partial<Pick<TourStop, 'title' | 'note'>>) => void;
  removeStop: (id: string) => void;
  moveStop: (id: string, delta: -1 | 1) => void;
  generate: () => Promise<void>;

  start: (index?: number) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  end: () => void;

  refreshRemote: () => Promise<void>;
  follow: () => Promise<void>;
  unfollow: () => void;
}

const projectId = () => useCommentsStore.getState().projectId;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function saveSoon(stops: TourStop[]): void {
  const id = projectId();
  if (!id) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    apiSaveTour(id, stops).catch((err) => toast(`Couldn't save the tour: ${err.message}`, 'error'));
  }, 400);
}

/** Show a stop: drill to its level if needed, then fly the camera there. */
async function showStop(stop: TourStop): Promise<void> {
  if (!(await ensureDiagramKnown(stop.diagramId))) return;
  const diagrams = useDiagramStore.getState();
  useSelectionStore.getState().clearSelection();
  if (diagrams.activeDiagramId !== stop.diagramId) {
    diagrams.navigateToDiagram(stop.diagramId);
    await loadDiagramElements(stop.diagramId).catch(() => undefined);
    // Let the canvas pick up the new level before moving the camera
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
  }
  await getCanvasController()?.flyTo?.(stop.viewport);
}

export const usePresentStore = create<PresentState>((set, get) => ({
  stops: [],
  panelOpen: false,
  presenting: false,
  index: 0,
  remote: null,
  following: false,

  loadTour: async () => {
    const id = projectId();
    if (!id) return;
    try {
      const { stops } = await apiGetTour(id);
      set({ stops });
    } catch {
      // Keep what we have (offline)
    }
  },

  setPanelOpen: (panelOpen) => {
    set({ panelOpen });
    if (panelOpen) void get().loadTour();
  },

  addCurrentView: () => {
    const diagramId = useDiagramStore.getState().activeDiagramId;
    const diagram = useDiagramStore.getState().diagrams.get(diagramId);
    const viewport = getCanvasController()?.getViewport?.() ?? null;
    const stop: TourStop = {
      id: stopId(),
      diagramId,
      viewport,
      title: diagram?.title ?? 'Untitled',
      note: '',
    };
    const stops = [...get().stops, stop];
    set({ stops });
    saveSoon(stops);
  },

  updateStop: (id, patch) => {
    const stops = get().stops.map((s) => (s.id === id ? { ...s, ...patch } : s));
    set({ stops });
    saveSoon(stops);
  },

  removeStop: (id) => {
    const stops = get().stops.filter((s) => s.id !== id);
    set({ stops });
    saveSoon(stops);
  },

  moveStop: (id, delta) => {
    const stops = [...get().stops];
    const i = stops.findIndex((s) => s.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= stops.length) return;
    [stops[i], stops[j]] = [stops[j], stops[i]];
    set({ stops });
    saveSoon(stops);
  },

  generate: async () => {
    const { diagrams, diagramPath } = useDiagramStore.getState();
    const rootId = diagramPath[0];
    // Every level's contents are needed to describe it
    await Promise.all(
      Array.from(diagrams.keys()).map((id) => loadDiagramElements(id).catch(() => undefined)),
    );
    const elements = Array.from(useElementsStore.getState().elements.values());
    const stops = generateTour(diagrams, elements, rootId);
    set({ stops });
    saveSoon(stops);
    toast(
      `Tour with ${stops.length} ${stops.length === 1 ? 'stop' : 'stops'} — one per level of the map.`,
      'success',
    );
  },

  start: async (index = 0) => {
    const { stops } = get();
    if (stops.length === 0) {
      toast('Add a stop (or generate a tour) first.', 'info');
      return;
    }
    const i = Math.min(Math.max(0, index), stops.length - 1);
    set({ presenting: true, index: i, following: false, panelOpen: false });
    await showStop(stops[i]);
    const id = projectId();
    if (id) void apiSetPresentation(id, i).catch(() => undefined);
  },

  next: async () => {
    const { presenting, index, stops } = get();
    if (!presenting || index >= stops.length - 1) return;
    set({ index: index + 1 });
    await showStop(stops[index + 1]);
    const id = projectId();
    if (id) void apiSetPresentation(id, index + 1).catch(() => undefined);
  },

  prev: async () => {
    const { presenting, index, stops } = get();
    if (!presenting || index <= 0) return;
    set({ index: index - 1 });
    await showStop(stops[index - 1]);
    const id = projectId();
    if (id) void apiSetPresentation(id, index - 1).catch(() => undefined);
  },

  end: () => {
    if (!get().presenting) return;
    set({ presenting: false });
    const id = projectId();
    if (id) void apiSetPresentation(id, null).catch(() => undefined);
  },

  refreshRemote: async () => {
    const id = projectId();
    if (!id) return;
    try {
      const { presentation } = await apiGetPresentation(id);
      const me = useAuthStore.getState().user?.id;
      const remote = presentation && presentation.presenterId !== me ? presentation : null;
      const wasFollowing = get().following;
      set({ remote, following: wasFollowing && !!remote });
      if (remote && wasFollowing) {
        if (get().stops.length <= remote.stop) await get().loadTour();
        const stop = get().stops[remote.stop];
        if (stop) {
          set({ index: remote.stop });
          await showStop(stop);
        }
      }
      // Someone else took over our presentation
      if (presentation && presentation.presenterId !== me && get().presenting) {
        set({ presenting: false });
      }
    } catch {
      // ignore (offline)
    }
  },

  follow: async () => {
    set({ following: true });
    await get().loadTour();
    await get().refreshRemote();
  },

  unfollow: () => set({ following: false }),
}));

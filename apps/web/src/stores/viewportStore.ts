import { create } from 'zustand';

/**
 * Mirror of the canvas viewport for React UI (zoom readout, minimap...).
 * The canvas owns the real viewport; it publishes changes here at most once
 * per frame, so subscribers never see more than 60 updates per second.
 */
interface ViewportState {
  zoom: number;
  scrollX: number;
  scrollY: number;
  setViewport: (v: { zoom: number; scrollX: number; scrollY: number }) => void;
}

export const useViewportStore = create<ViewportState>((set) => ({
  zoom: 1,
  scrollX: 0,
  scrollY: 0,
  setViewport: (v) => set(v),
}));

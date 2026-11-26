import type { MavisElement, Viewport } from '@mavisdraw/types';

/**
 * Dev-only window hooks used by Playwright e2e tests to observe editor state
 * that isn't otherwise visible in the DOM (canvas contents, viewport).
 * Never installed in production builds.
 */
export interface MavisDrawTestHooks {
  getViewport: () => Viewport;
  getActiveElements: () => MavisElement[];
  getActiveDiagramId: () => string;
}

interface TestWindow {
  __MAVISDRAW__?: MavisDrawTestHooks;
  /** Legacy hook kept for existing e2e specs. */
  __MAVISDRAW_GET_VIEWPORT__?: () => Viewport;
}

export function installTestHooks(hooks: MavisDrawTestHooks): () => void {
  if (!import.meta.env.DEV) return () => {};
  const w = window as unknown as TestWindow;
  w.__MAVISDRAW__ = hooks;
  w.__MAVISDRAW_GET_VIEWPORT__ = hooks.getViewport;
  return () => {
    delete w.__MAVISDRAW__;
    delete w.__MAVISDRAW_GET_VIEWPORT__;
  };
}

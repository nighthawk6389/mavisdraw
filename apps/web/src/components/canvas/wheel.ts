/**
 * Turns raw wheel events into navigation intents.
 *
 * Mouse wheels zoom (the Miro-style behaviour this app chose), while trackpad
 * two-finger scrolls pan and pinches zoom smoothly. Browsers don't say which
 * device produced a wheel event, so we classify with a few robust signals and
 * keep the classification sticky for the rest of a gesture (trackpad momentum
 * can produce large, mouse-like deltas).
 */

export type WheelBehavior = 'auto' | 'zoom' | 'pan';
export type WheelDevice = 'mouse' | 'trackpad';

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  timeStamp: number;
  /** Non-standard but widely supported; helps spot macOS trackpads. */
  wheelDeltaY?: number;
}

export type WheelIntent =
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'none' };

const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 800;
/** Events closer together than this belong to the same gesture. */
const GESTURE_GAP_MS = 250;

function toPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * LINE_HEIGHT_PX;
  if (deltaMode === 2) return delta * PAGE_HEIGHT_PX;
  return delta;
}

export function classifyWheelDevice(e: WheelInput): WheelDevice {
  if (e.deltaX !== 0) return 'trackpad';
  if (e.deltaMode !== 0) return 'mouse';
  const wdy = e.wheelDeltaY;
  if (typeof wdy === 'number' && wdy !== 0) {
    // macOS (Chrome/Safari) reports wheelDelta = -3 × delta for trackpads
    if (Math.abs(Math.abs(wdy) - Math.abs(e.deltaY) * 3) < 1) return 'trackpad';
    if (wdy % 120 === 0) return 'mouse';
  }
  return Math.abs(e.deltaY) >= 50 ? 'mouse' : 'trackpad';
}

export class WheelInterpreter {
  private lastDevice: WheelDevice | null = null;
  private lastTime = Number.NEGATIVE_INFINITY;

  constructor(private behavior: WheelBehavior = 'auto') {}

  setBehavior(behavior: WheelBehavior): void {
    this.behavior = behavior;
  }

  interpret(e: WheelInput): WheelIntent {
    const dx = toPixels(e.deltaX, e.deltaMode);
    const dy = toPixels(e.deltaY, e.deltaMode);
    if (dx === 0 && dy === 0) return { kind: 'none' };

    // Pinch-to-zoom (trackpads send ctrl+wheel) and Ctrl/⌘+wheel
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.max(0.5, Math.min(2, 1 - dy * 0.01));
      return { kind: 'zoom', factor };
    }

    let device = classifyWheelDevice(e);
    if (this.lastDevice === 'trackpad' && e.timeStamp - this.lastTime < GESTURE_GAP_MS) {
      device = 'trackpad';
    }
    this.lastDevice = device;
    this.lastTime = e.timeStamp;

    const shouldZoom =
      this.behavior === 'zoom' || (this.behavior === 'auto' && device === 'mouse' && !e.shiftKey);

    if (shouldZoom) {
      if (dy === 0) return { kind: 'none' };
      return { kind: 'zoom', factor: dy > 0 ? 0.9 : 1.1 };
    }

    // Shift + vertical wheel scrolls horizontally, as in every other canvas app
    if (e.shiftKey && dx === 0) return { kind: 'pan', dx: -dy, dy: 0 };
    return { kind: 'pan', dx: -dx || 0, dy: -dy || 0 };
  }
}

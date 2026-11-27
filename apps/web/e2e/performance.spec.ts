import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

type Hooks = {
  seedRectangles: (n: number) => void;
  getDrawnCount: () => number;
};

function hooks(page: Page) {
  return {
    seed: (n: number) =>
      page.evaluate(
        (count) =>
          (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__.seedRectangles(count),
        n,
      ),
    drawn: () =>
      page.evaluate(() =>
        (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__.getDrawnCount(),
      ),
  };
}

/** Average time per animation frame while panning continuously. */
async function measurePanFrameTime(page: Page, frames = 60): Promise<number> {
  const box = (await page.locator('canvas').last().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  return page.evaluate(async (n) => {
    const canvas = document.querySelectorAll('canvas')[1] as HTMLCanvasElement;
    const times: number[] = [];
    let last = performance.now();
    for (let i = 0; i < n; i++) {
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaX: 7, deltaY: 5, bubbles: true, cancelable: true }),
      );
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      times.push(now - last);
      last = now;
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
  }, frames);
}

/**
 * Median cost of one pointer move while dragging (event handling, store
 * update and any React work it triggers), one move per frame.
 */
async function measureDragMoveCost(page: Page, moves = 60): Promise<number> {
  return page.evaluate(async (n) => {
    const hooks = (
      window as unknown as {
        __MAVISDRAW__: { getViewport: () => { zoom: number; scrollX: number; scrollY: number } };
      }
    ).__MAVISDRAW__;
    const vp = hooks.getViewport();
    const canvas = document.querySelectorAll('canvas')[1] as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    // Grab the first seeded rectangle (at 0,0, 120×80)
    const x = rect.left + vp.scrollX + 60 * vp.zoom;
    const y = rect.top + vp.scrollY + 40 * vp.zoom;
    const fire = (type: string, cx: number, cy: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          clientX: cx,
          clientY: cy,
          bubbles: true,
          pointerId: 1,
          button: 0,
          buttons: 1,
          pointerType: 'mouse',
          isPrimary: true,
        }),
      );
    fire('pointerdown', x, y);
    const costs: number[] = [];
    for (let i = 1; i <= n; i++) {
      const t0 = performance.now();
      fire('pointermove', x + i * 3, y + i * 2);
      await new Promise((r) => setTimeout(r, 0)); // include React work the move scheduled
      costs.push(performance.now() - t0);
      await new Promise((r) => requestAnimationFrame(r));
    }
    fire('pointerup', x + n * 3, y + n * 2);
    costs.sort((a, b) => a - b);
    return costs[Math.floor(costs.length / 2)];
  }, moves);
}

/** Median static-canvas pass while panning (every frame is a full redraw). */
async function staticMsWhilePanning(page: Page, frames = 40): Promise<number> {
  return page.evaluate(async (n) => {
    const hooks = (window as unknown as { __MAVISDRAW__: { getLastStaticMs: () => number } })
      .__MAVISDRAW__;
    const canvas = document.querySelectorAll('canvas')[1] as HTMLCanvasElement;
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaX: 3, deltaY: 2, bubbles: true, cancelable: true }),
      );
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      times.push(hooks.getLastStaticMs());
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
  }, frames);
}

/**
 * Drag a shape: the median static-canvas pass, the share of frames drawn
 * from the cached bitmaps, and how much the last of them differs from
 * drawing everything.
 */
async function staticMsWhileDragging(
  page: Page,
  [x, y]: [number, number],
  moves = 40,
): Promise<{ median: number; cached: number; lastWasCached: boolean; differing: number }> {
  return page.evaluate(
    async ({ n, x, y }) => {
      const hooks = (
        window as unknown as {
          __MAVISDRAW__: {
            getLastStaticMs: () => number;
            getLastStaticPath: () => string;
          };
        }
      ).__MAVISDRAW__;
      const canvas = document.querySelectorAll('canvas')[1] as HTMLCanvasElement;
      const fire = (type: string, cx: number, cy: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            clientX: cx,
            clientY: cy,
            bubbles: true,
            pointerId: 1,
            button: 0,
            buttons: 1,
            pointerType: 'mouse',
            isPrimary: true,
          }),
        );
      fire('pointerdown', x, y);
      const times: number[] = [];
      const paths: string[] = [];
      for (let i = 1; i <= n; i++) {
        fire('pointermove', x + i * 3, y + i * 2);
        await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => requestAnimationFrame(r));
        if (i > 3) times.push(hooks.getLastStaticMs()); // past the drag threshold and the first build
        if (i > 3) paths.push(hooks.getLastStaticPath());
      }
      // The last frame came from the cache: is it what drawing everything gives?
      const staticCanvas = document.querySelectorAll('canvas')[0] as HTMLCanvasElement;
      const read = () =>
        staticCanvas.getContext('2d')!.getImageData(0, 0, staticCanvas.width, staticCanvas.height)
          .data;
      const lastWasCached = hooks.getLastStaticPath() === 'cached';
      const fromCache = read();
      hooks.redrawStatic();
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      const redrawn = read();
      let different = 0;
      for (let i = 0; i < fromCache.length; i += 4) {
        let d = 0;
        for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(fromCache[i + c] - redrawn[i + c]));
        // Blending a bitmap rounds a little at anti-aliased edges; nothing more
        if (d > 3) different++;
      }
      fire('pointerup', x + n * 3, y + n * 2);
      times.sort((a, b) => a - b);
      return {
        median: times[Math.floor(times.length / 2)],
        cached: paths.filter((p) => p === 'cached').length / paths.length,
        lastWasCached,
        differing: different / (fromCache.length / 4),
      };
    },
    { n: moves, x, y },
  );
}

/** The id of the shape nearest the middle of the canvas (clear of edge auto-pan). */
function middleShape(page: Page): Promise<string> {
  return page.evaluate(() => {
    const hooks = (
      window as unknown as {
        __MAVISDRAW__: {
          getViewport: () => { zoom: number; scrollX: number; scrollY: number };
          getActiveElements: () => Array<{
            id: string;
            x: number;
            y: number;
            width: number;
            height: number;
          }>;
        };
      }
    ).__MAVISDRAW__;
    const vp = hooks.getViewport();
    const rect = document.querySelectorAll('canvas')[1].getBoundingClientRect();
    const cx = (rect.width / 2 - vp.scrollX) / vp.zoom;
    const cy = (rect.height / 2 - vp.scrollY) / vp.zoom;
    let best = '';
    let bestD = Infinity;
    for (const el of hooks.getActiveElements()) {
      const d = Math.hypot(el.x + el.width / 2 - cx, el.y + el.height / 2 - cy);
      if (d < bestD) {
        bestD = d;
        best = el.id;
      }
    }
    return best;
  });
}

/** Where a shape's centre is on screen now. */
function screenPointOf(page: Page, id: string): Promise<[number, number]> {
  return page.evaluate((elementId) => {
    const hooks = (
      window as unknown as {
        __MAVISDRAW__: {
          getViewport: () => { zoom: number; scrollX: number; scrollY: number };
          getActiveElements: () => Array<{
            id: string;
            x: number;
            y: number;
            width: number;
            height: number;
          }>;
        };
      }
    ).__MAVISDRAW__;
    const vp = hooks.getViewport();
    const rect = document.querySelectorAll('canvas')[1].getBoundingClientRect();
    const el = hooks.getActiveElements().find((e) => e.id === elementId)!;
    return [
      rect.left + vp.scrollX + (el.x + el.width / 2) * vp.zoom,
      rect.top + vp.scrollY + (el.y + el.height / 2) * vp.zoom,
    ];
  }, id);
}

test.describe('Rendering performance', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('only draws elements inside the viewport', async ({ page }) => {
    const h = hooks(page);
    await h.seed(2000);
    // The default viewport shows only a small corner of a 2,000-shape grid
    await expect.poll(() => h.drawn()).toBeGreaterThan(0);
    const drawn = await h.drawn();
    expect(drawn).toBeLessThan(200);
  });

  test('panning a 2,000-element diagram stays interactive', async ({ page }) => {
    const h = hooks(page);
    await h.seed(2000);
    await page.keyboard.press('Shift+1'); // zoom to fit: everything visible, worst case
    await expect.poll(() => h.drawn()).toBeGreaterThan(1500);
    const median = await measurePanFrameTime(page);
    console.log(`median frame time while panning 2,000 visible shapes: ${median.toFixed(1)}ms`);
    // Generous bound for CI machines; locally this is ~1 frame
    expect(median).toBeLessThan(50);
  });

  test('dragging a shape in a 2,000-element diagram stays cheap per pointer move', async ({
    page,
  }) => {
    const h = hooks(page);
    await h.seed(2000);
    await page.keyboard.press('Shift+1');
    await expect.poll(() => h.drawn()).toBeGreaterThan(1500);
    const median = await measureDragMoveCost(page);
    console.log(
      `median cost per pointer move, dragging among 2,000 shapes: ${median.toFixed(1)}ms`,
    );
    // One batched store update and no editor-wide re-render per move: ~7ms
    // in a dev build on an idle machine (~12ms before), up to ~20ms with
    // the whole suite running in parallel. Generous bound, like the pan test:
    // it catches per-element store updates or render cascades coming back.
    expect(median).toBeLessThan(40);
  });

  test('a drag redraws only what moves, and the picture is the same as a full redraw', async ({
    page,
  }) => {
    const h = hooks(page);
    await h.seed(2000);
    await page.keyboard.press('Shift+1');
    await expect.poll(() => h.drawn()).toBeGreaterThan(1500);
    const full = await staticMsWhilePanning(page);
    // A shape in the middle, clear of the edges (auto-pan scrolls the view,
    // and every scroll is a full redraw, as it must be)
    const shapeId = await middleShape(page);
    const before = await screenPointOf(page, shapeId);
    const drag = await staticMsWhileDragging(page, before);
    // It really moved
    const after = await screenPointOf(page, shapeId);
    expect(after[0]).toBeGreaterThan(before[0] + 50);
    console.log(
      `static layer, 2,000 shapes: ${full.toFixed(1)}ms a frame panning, ${drag.median.toFixed(1)}ms dragging`,
    );
    // The shapes that don't move come from bitmaps (~0.5ms vs ~4ms in a dev build)
    expect(drag.cached).toBeGreaterThan(0.8);
    expect(drag.median).toBeLessThan(full / 2);

    // What the cached frames show is what drawing everything shows
    expect(drag.lastWasCached).toBe(true);
    expect(drag.differing).toBeLessThan(0.001);
  });

  test('sketchy mode reuses cached hand-drawn shapes while panning', async ({ page }) => {
    const h = hooks(page);
    await h.seed(2000);
    await page.getByTestId('toolbar').locator('button[title^="Mode:"]').click();
    await page.keyboard.press('Shift+1');
    await expect.poll(() => h.drawn()).toBeGreaterThan(1500);
    // First pan pays for generating the rough shapes; measure steady state
    await measurePanFrameTime(page, 10);
    const median = await measurePanFrameTime(page);
    console.log(`median frame time, sketchy mode, 2,000 visible shapes: ${median.toFixed(1)}ms`);
    expect(median).toBeLessThan(100);
  });
});

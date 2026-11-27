import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

type Hooks = {
  seedRectangles: (n: number) => void;
  getDrawnCount: () => number;
};

function hooks(page: Page) {
  return {
    seed: (n: number) =>
      page.evaluate((count) => (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__.seedRectangles(count), n),
    drawn: () =>
      page.evaluate(() => (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__.getDrawnCount()),
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
    console.log(`median cost per pointer move, dragging among 2,000 shapes: ${median.toFixed(1)}ms`);
    // One batched store update and no editor-wide re-render per move: ~7ms
    // in a dev build on an idle machine (~12ms before), up to ~20ms with
    // the whole suite running in parallel. Generous bound, like the pan test:
    // it catches per-element store updates or render cascades coming back.
    expect(median).toBeLessThan(40);
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

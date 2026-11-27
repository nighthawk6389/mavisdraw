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

import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

type Hooks = {
  seedRectangles: (n: number) => void;
  getDrawnCount: () => number;
  getSelectedIds: () => string[];
  getActiveElements: () => Array<{ id: string; x: number; strokeColor: string }>;
  isRenderLoopAwake: () => boolean;
};
const call = <T>(page: Page, fn: (h: Hooks) => T) =>
  page.evaluate(
    (src) =>
      new Function('h', `return (${src})(h)`)(
        (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__,
      ),
    fn.toString(),
  ) as Promise<T>;

test.describe('Editor speed', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('the render loop sleeps when nothing changes, and wakes for a change', async ({ page }) => {
    await expect
      .poll(() => call(page, (h) => h.isRenderLoopAwake()), { timeout: 8000 })
      .toBe(false);
    // A change from outside the canvas (as from a collaborator) still gets drawn
    await call(page, (h) => h.seedRectangles(3));
    await expect.poll(() => call(page, (h) => h.getDrawnCount())).toBe(3);
    // And the pointer wakes it
    await expect
      .poll(() => call(page, (h) => h.isRenderLoopAwake()), { timeout: 8000 })
      .toBe(false);
    const box = (await page.locator('canvas').nth(1).boundingBox())!;
    await page.mouse.move(box.x + 300, box.y + 300);
    expect(await call(page, (h) => h.isRenderLoopAwake())).toBe(true);
  });

  test('nudging or restyling 2,000 selected shapes takes one quick update', async ({ page }) => {
    await call(page, (h) => h.seedRectangles(2000));
    await page
      .locator('canvas')
      .nth(1)
      .click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await expect.poll(() => call(page, (h) => h.getSelectedIds().length)).toBe(2000);
    const firstX = await call(page, (h) => h.getActiveElements()[0].x);

    const nudge = await page.evaluate(() => {
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      return performance.now() - t0;
    });
    expect(await call(page, (h) => h.getActiveElements()[0].x)).toBe(firstX + 1);
    // It took seconds before (one store update per shape)
    expect(nudge).toBeLessThan(400);

    const swatch = page.getByRole('button', { name: /Stroke colour #e03131/i }).first();
    await expect(swatch).toBeVisible();
    const restyle = await swatch.evaluate((button) => {
      const t0 = performance.now();
      (button as HTMLButtonElement).click();
      return performance.now() - t0;
    });
    await expect
      .poll(() =>
        call(page, (h) => h.getActiveElements().every((e) => e.strokeColor === '#e03131')),
      )
      .toBe(true);
    expect(restyle).toBeLessThan(600);
  });
});

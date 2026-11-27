import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

/**
 * Selecting a shape opens the inspector (style, and the component it shows)
 * beside the canvas, which narrows it: the shape must stay in view.
 */

type Hooks = {
  getActiveElements: () => Array<{ id: string; x: number; width: number }>;
  getSelectedIds: () => string[];
  getViewport: () => { zoom: number; scrollX: number; scrollY: number };
};
const hooks = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__;
    return { els: h.getActiveElements(), selected: h.getSelectedIds(), vp: h.getViewport() };
  });

test('a shape selected near the right edge stays visible when the inspector opens', async ({
  page,
}) => {
  await mockAuthAndOpenEditor(page);
  const canvas = page.locator('canvas').last();
  const before = (await canvas.boundingBox())!;

  // Draw a box right against the canvas's right edge (it's selected after)
  await page.keyboard.press('r');
  await page.mouse.move(before.x + before.width - 150, before.y + 200);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width - 30, before.y + 260, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('style-panel')).toBeVisible();

  const after = (await canvas.boundingBox())!;
  expect(after.width).toBeLessThan(before.width); // the inspector took room
  const { els, selected, vp } = await hooks(page);
  expect(selected).toHaveLength(1);
  const box = els.find((e) => e.id === selected[0])!;
  const right = (box.x + box.width) * vp.zoom + vp.scrollX;
  const left = box.x * vp.zoom + vp.scrollX;
  expect(right).toBeLessThanOrEqual(after.width);
  expect(left).toBeGreaterThanOrEqual(0);
});

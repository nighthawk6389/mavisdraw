import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

/** Lasso (Alt+drag on empty canvas): select exactly what you draw around. */

type El = { id: string; type: string; x: number; y: number };
type Hooks = { getActiveElements: () => El[]; getSelectedIds: () => string[] };
const hooks = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__;
    return { elements: h.getActiveElements(), selected: h.getSelectedIds() };
  });

async function box(page: Page) {
  return (await page.locator('canvas').nth(1).boundingBox())!;
}

async function draw(page: Page, key: string, from: [number, number], to: [number, number]) {
  const b = await box(page);
  await page.keyboard.press(key);
  await page.mouse.move(b.x + from[0], b.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + to[0], b.y + to[1], { steps: 5 });
  await page.mouse.up();
}

/** Draw a loop through these points with Alt held. */
async function lasso(page: Page, points: Array<[number, number]>, release = true) {
  const b = await box(page);
  await page.keyboard.down('Alt');
  await page.mouse.move(b.x + points[0][0], b.y + points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(b.x + x, b.y + y, { steps: 6 });
  await page.keyboard.up('Alt');
  if (release) await page.mouse.up();
}

/** An L around the top-left and bottom-right shapes, but not the top-right one. */
const AROUND_L: Array<[number, number]> = [
  [60, 60],
  [230, 60],
  [230, 330],
  [520, 330],
  [520, 460],
  [60, 460],
  [60, 60],
];

test.describe('Lasso selection', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
    await draw(page, 'r', [100, 100], [200, 180]); // top-left
    await draw(page, 'r', [380, 100], [480, 180]); // top-right
    await draw(page, 'r', [380, 360], [480, 440]); // bottom-right
    await page.keyboard.press('Escape');
  });

  test('selects what the loop goes around, which a box couldn’t', async ({ page }) => {
    const { elements } = await hooks(page);
    const byPos = (x: number, y: number) =>
      elements.find((e) => Math.abs(e.x - x) < 5 && Math.abs(e.y - y) < 5)!.id;
    await lasso(page, AROUND_L);
    expect((await hooks(page)).selected.sort()).toEqual([byPos(100, 100), byPos(380, 360)].sort());
  });

  test('Escape while drawing it keeps the selection as it was', async ({ page }) => {
    const b = await box(page);
    await page.mouse.click(b.x + 430, b.y + 140);
    const before = (await hooks(page)).selected;
    expect(before).toHaveLength(1);
    await lasso(page, AROUND_L, false);
    expect((await hooks(page)).selected).toHaveLength(2);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect((await hooks(page)).selected).toEqual(before);
  });
});

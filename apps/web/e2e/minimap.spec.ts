import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

/** The overview map (M): where everything is, and click to go there. */

const viewport = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        __MAVISDRAW__: { getViewport: () => { zoom: number; scrollX: number; scrollY: number } };
      }
    ).__MAVISDRAW__.getViewport(),
  );

test('M shows the overview; clicking in it moves the view; it stays on after a reload', async ({
  page,
}) => {
  await mockAuthAndOpenEditor(page);
  const box = (await page.locator('canvas').nth(1).boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('minimap')).toHaveCount(0);
  await page.keyboard.press('m');
  const minimap = page.getByTestId('minimap');
  await expect(minimap).toBeVisible();
  await expect(page.getByTestId('minimap-toggle')).toHaveAttribute('aria-pressed', 'true');

  // Click near the overview's right edge: the view moves right
  const before = await viewport(page);
  const mb = (await minimap.boundingBox())!;
  await page.mouse.click(mb.x + mb.width - 10, mb.y + mb.height / 2);
  await expect.poll(async () => (await viewport(page)).scrollX).toBeLessThan(before.scrollX - 20);

  await page.reload();
  await expect(page.getByTestId('minimap')).toBeVisible();
  await page.getByTestId('minimap-toggle').click();
  await expect(page.getByTestId('minimap')).toHaveCount(0);
});

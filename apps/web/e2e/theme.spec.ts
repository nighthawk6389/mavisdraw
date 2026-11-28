import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

/**
 * Dark mode: follows the system until the person picks one, is remembered,
 * and shows the board dark (inverted, the way Excalidraw does) without
 * changing what's stored.
 */

const isDark = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains('dark'));
const background = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe('Dark mode', () => {
  test('follows the system, and the toolbar switch is remembered', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await mockAuthAndOpenEditor(page);
    expect(await isDark(page)).toBe(true);
    // Panels are dark, and the board is inverted for display
    expect(await background(page, 'toolbar')).toBe('rgb(28, 28, 32)');
    const filter = await page
      .locator('canvas.mavis-canvas-layer')
      .first()
      .evaluate((el) => getComputedStyle(el).filter);
    expect(filter).toContain('invert');

    // Picked light: stays light after a reload, whatever the system says
    await page.getByTestId('theme-toggle').click();
    expect(await isDark(page)).toBe(false);
    expect(await background(page, 'toolbar')).toBe('rgb(255, 255, 255)');
    await page.reload();
    await expect(page.getByTestId('toolbar')).toBeVisible();
    expect(await isDark(page)).toBe(false);
  });

  test('Shift+Alt+D switches, and shapes keep the colours they were drawn with', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await mockAuthAndOpenEditor(page);
    expect(await isDark(page)).toBe(false);
    const canvas = page.locator('canvas').nth(1);
    const box = (await canvas.boundingBox())!;
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 220, box.y + 180, { steps: 5 });
    await page.mouse.up();

    await page.keyboard.press('Shift+Alt+D');
    expect(await isDark(page)).toBe(true);
    const stroke = await page.evaluate(
      () =>
        (
          window as unknown as {
            __MAVISDRAW__: { getActiveElements: () => Array<{ strokeColor: string }> };
          }
        ).__MAVISDRAW__.getActiveElements()[0].strokeColor,
    );
    expect(stroke).toBe('#1e1e1e');
    await page.keyboard.press('Shift+Alt+D');
    expect(await isDark(page)).toBe(false);
  });
});

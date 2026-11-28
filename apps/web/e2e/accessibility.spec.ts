import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

/** The editor on a keyboard and with a screen reader. */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const focusedLabel = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
const selected = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __MAVISDRAW__: { getSelectedIds: () => string[] } }
    ).__MAVISDRAW__.getSelectedIds(),
  );

async function drawBox(page: Page, x: number, y: number) {
  const box = (await page.locator('canvas').nth(1).boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 100, box.y + y + 60, { steps: 4 });
  await page.mouse.up();
}

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('the toolbar is one Tab stop; arrows move through it, Enter picks', async ({ page }) => {
    const toolbar = page.getByRole('toolbar', { name: 'Tools' });
    await expect(toolbar).toBeVisible();
    // Only the current tool can be tabbed to
    await expect(toolbar.locator('[tabindex="0"]')).toHaveCount(1);
    await toolbar.locator('[tabindex="0"]').focus();
    expect(await focusedLabel(page)).toContain('Select');
    await page.keyboard.press('ArrowDown');
    expect(await focusedLabel(page)).toBe('Hand (pan)');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Hand (pan)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('End');
    expect(await focusedLabel(page)).toContain('Switch to');
    await page.keyboard.press('Home');
    expect(await focusedLabel(page)).toContain('Select');
  });

  test('a dialog takes focus, keeps Tab inside, and gives focus back on Escape', async ({
    page,
  }) => {
    const toolbarButton = page.getByRole('toolbar', { name: 'Tools' }).locator('[tabindex="0"]');
    await toolbarButton.focus();
    await page.keyboard.press(`${mod}+Shift+E`);
    const dialog = page.getByRole('dialog', { name: 'Export' });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await focusedLabel(page)).toContain('Select');
  });

  test('Tab moves between shapes on the canvas, says what’s selected, then leaves', async ({
    page,
  }) => {
    await drawBox(page, 100, 100);
    await drawBox(page, 300, 100);
    await page.keyboard.press('Escape');
    const canvas = page.getByRole('application', { name: /Diagram canvas/ });
    await canvas.focus();
    await page.keyboard.press('Tab');
    expect(await selected(page)).toHaveLength(1);
    const first = (await selected(page))[0];
    await expect(page.getByTestId('canvas-announcer')).toHaveText('Rectangle selected');
    await page.keyboard.press('Tab');
    const second = (await selected(page))[0];
    expect(second).not.toBe(first);
    await page.keyboard.press('Shift+Tab');
    expect((await selected(page))[0]).toBe(first);
    // Past the last shape: focus leaves the canvas, nothing stays selected
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await selected(page)).toEqual([]);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('CANVAS');
  });

  test('panels and their controls have names', async ({ page }) => {
    await drawBox(page, 100, 100);
    const style = page.getByRole('complementary', { name: 'Style' });
    await expect(style).toBeVisible();
    await expect(style.getByRole('slider', { name: 'Opacity' })).toBeVisible();
    await expect(style.getByRole('textbox', { name: 'Stroke colour (hex)' })).toBeVisible();
    await expect(style.getByRole('button', { name: 'Solid' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByRole('complementary', { name: 'Diagrams' })).toBeVisible();
  });
});

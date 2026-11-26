import { test, expect, type Page } from '@playwright/test';
import { dragOnCanvas, getActiveElements, interactiveCanvas, twoPeople } from './helpers';

async function labelledBox(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  text: string,
) {
  await page.keyboard.press('r');
  await dragOnCanvas(page, from, to);
  const box = (await interactiveCanvas(page).boundingBox())!;
  await page.mouse.dblclick(box.x + (from.x + to.x) / 2, box.y + (from.y + to.y) / 2);
  await expect(page.locator('[contenteditable="true"]')).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test('a reviewer sees exactly what changed since a version, on the canvas', async ({ browser }) => {
  const { ctxA, ctxB, a, b } = await twoPeople(browser, 'viewer');
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  // Alice builds a first cut and saves it as a version
  await labelledBox(a, { x: 120, y: 120 }, { x: 280, y: 200 }, 'Auth');
  await labelledBox(a, { x: 360, y: 120 }, { x: 520, y: 200 }, 'Legacy Cache');
  await expect.poll(async () => (await getActiveElements(b)).length).toBe(4);
  await a.getByRole('button', { name: 'History' }).click();
  await a.getByPlaceholder('Version label...').fill('First cut');
  await a.getByPlaceholder('Version label...').press('Enter');
  await expect(a.getByTestId('version-entry').filter({ hasText: 'First cut' })).toBeVisible();

  // Then she renames Auth, removes the cache, and adds a queue
  const canvas = (await interactiveCanvas(a).boundingBox())!;
  await a.mouse.dblclick(canvas.x + 200, canvas.y + 160);
  await expect(a.locator('[contenteditable="true"]')).toBeFocused();
  await a.keyboard.press(`${mod}+a`);
  await a.keyboard.type('Auth Service');
  await a.keyboard.press('Enter');
  await a.keyboard.press('Escape');
  await a.mouse.click(canvas.x + 440, canvas.y + 160); // its label selects the box
  await a.keyboard.press('Delete');
  await labelledBox(a, { x: 360, y: 280 }, { x: 520, y: 360 }, 'Queue');

  // Bob (view only) compares that version with now
  await expect.poll(async () => (await getActiveElements(b)).length).toBe(4);
  await b.getByRole('button', { name: 'History' }).click();
  const entry = b.getByTestId('version-entry').filter({ hasText: 'First cut' });
  await entry.hover();
  await entry.getByRole('button', { name: 'Compare' }).click();

  const banner = b.getByTestId('diff-banner');
  await expect(banner).toContainText('Changes since First cut');
  await expect(banner).toContainText('1 added');
  await expect(banner).toContainText('1 changed');
  await expect(banner).toContainText('1 removed');
  const items = b.getByTestId('diff-item');
  await expect(items).toHaveCount(3);
  await expect(items.filter({ hasText: 'Queue' })).toContainText('added');
  await expect(items.filter({ hasText: 'Auth Service' })).toContainText(
    'Renamed “Auth” → “Auth Service”',
  );
  await expect(items.filter({ hasText: 'Legacy Cache' })).toContainText('removed');

  // On the canvas: one outline per change, the removed one as a labelled ghost
  const overlay = b.getByTestId('diff-overlay');
  await expect(overlay.locator('g[data-kind]')).toHaveCount(3);
  await expect(overlay.locator('g[data-kind="removed"] text')).toHaveText('Legacy Cache');

  // It's live: Alice renames the queue and the list follows
  await a.mouse.dblclick(canvas.x + 440, canvas.y + 320);
  await expect(a.locator('[contenteditable="true"]')).toBeFocused();
  await a.keyboard.press(`${mod}+a`);
  await a.keyboard.type('Job Queue');
  await a.keyboard.press('Enter');
  await expect(items.filter({ hasText: 'Job Queue' })).toBeVisible();

  // Escape (or Done) ends the comparison
  await b.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

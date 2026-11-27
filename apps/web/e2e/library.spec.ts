import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor, collectErrors } from './helpers/auth';

interface El {
  id: string;
  type: string;
  icon?: string;
  strokeColor: string;
  text?: string;
  containerId?: string | null;
}

const elements = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __MAVISDRAW__: { getActiveElements: () => El[] } }
    ).__MAVISDRAW__.getActiveElements(),
  );

async function clickCanvas(page: Page, x: number, y: number) {
  const box = (await page.locator('canvas').last().boundingBox())!;
  await page.mouse.click(box.x + x, box.y + y);
}

test.describe('Shapes and icons for architecture', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('datastores and queues are tools of their own (B, U)', async ({ page }) => {
    const errors = collectErrors(page);
    await page.keyboard.press('b');
    await clickCanvas(page, 250, 200);
    await page.keyboard.press('u');
    await clickCanvas(page, 500, 200);
    await expect
      .poll(async () => (await elements(page)).map((e) => e.type).sort())
      .toEqual(['cylinder', 'queue']);
    expect(errors).toEqual([]);
  });

  test('the library puts a cloud service on the canvas, with its icon, label and colour', async ({
    page,
  }) => {
    await page.getByTestId('library-button').click();
    const panel = page.getByTestId('library-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('searchbox', { name: 'Search the library' }).fill('s3');
    await expect(panel.getByTestId('library-item').first()).toHaveAttribute('data-entry', 'aws-s3');
    await panel.getByTestId('library-item').first().click();
    await expect.poll(async () => (await elements(page)).length).toBe(2);
    const all = await elements(page);
    const shape = all.find((e) => e.type !== 'text')!;
    expect(shape).toMatchObject({ type: 'rectangle', icon: 'archive', strokeColor: '#c2410c' });
    expect(all.find((e) => e.containerId === shape.id)?.text).toBe('S3');

    // A provider at a time; Enter adds the first match; Escape closes
    await panel.getByRole('button', { name: 'Kubernetes' }).click();
    const search = panel.getByRole('searchbox', { name: 'Search the library' });
    await search.fill('pod');
    await search.press('Enter');
    await expect
      .poll(async () => (await elements(page)).filter((e) => e.icon === 'box').length)
      .toBe(1);
    await search.fill('postgres');
    await expect(panel.getByTestId('library-item')).toHaveCount(0); // not a Kubernetes thing
    await panel.getByRole('button', { name: 'All' }).click();
    await expect(panel.getByTestId('library-item').first()).toHaveAttribute(
      'data-entry',
      'generic-database',
    );
    await search.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('any shape can take an icon from the style panel, and lose it again', async ({ page }) => {
    await page.keyboard.press('r');
    await clickCanvas(page, 300, 250);
    const picker = page.getByTestId('icon-select');
    await expect(picker).toBeVisible();
    await picker.selectOption('database');
    await expect
      .poll(async () => (await elements(page)).find((e) => e.type === 'rectangle')?.icon)
      .toBe('database');
    await picker.selectOption('');
    await expect
      .poll(async () => (await elements(page)).find((e) => e.type === 'rectangle')?.icon)
      .toBe('');
  });
});

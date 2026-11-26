import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor, collectErrors } from './helpers/auth';

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isLocked?: boolean;
  text?: string;
  containerId?: string | null;
};

const hooks = {
  elements: (page: Page) =>
    page.evaluate(
      () => (window as unknown as { __MAVISDRAW__: { getActiveElements: () => El[] } }).__MAVISDRAW__.getActiveElements(),
    ),
  selected: (page: Page) =>
    page.evaluate(
      () => (window as unknown as { __MAVISDRAW__: { getSelectedIds: () => string[] } }).__MAVISDRAW__.getSelectedIds(),
    ),
  viewport: (page: Page) =>
    page.evaluate(
      () =>
        (window as unknown as { __MAVISDRAW__: { getViewport: () => { zoom: number; scrollX: number; scrollY: number } } })
          .__MAVISDRAW__.getViewport(),
    ),
};

async function canvasBox(page: Page) {
  const box = await page.locator('canvas').last().boundingBox();
  if (!box) throw new Error('no canvas');
  return box;
}

/** Draw a rectangle by dragging between two canvas-relative points. */
async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number) {
  const box = await canvasBox(page);
  await page.keyboard.press('r');
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 6 });
  await page.mouse.up();
}

async function dragFrom(page: Page, x1: number, y1: number, x2: number, y2: number) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 8 });
  await page.mouse.up();
}

async function rightClick(page: Page, x: number, y: number) {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + x, box.y + y, { button: 'right' });
}

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Phase 1 editing', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('trackpad two-finger scroll pans instead of zooming', async ({ page }) => {
    const box = await canvasBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const before = await hooks.viewport(page);
    await page.mouse.wheel(30, 40);
    await expect.poll(async () => (await hooks.viewport(page)).scrollY).toBe(before.scrollY - 40);
    const after = await hooks.viewport(page);
    expect(after.zoom).toBe(before.zoom);
    expect(after.scrollX).toBe(before.scrollX - 30);
  });

  test('pinch zoom zooms the canvas without browser warnings', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.text().includes('preventDefault')) errors.push(m.text());
    });
    const box = await canvasBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -10);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await hooks.viewport(page)).zoom).toBeGreaterThan(1);
    expect(errors.filter((e) => e.includes('preventDefault'))).toEqual([]);
  });

  test('zoom controls show the level and zoom in, reset and fit', async ({ page }) => {
    const level = page.getByTestId('zoom-level');
    await expect(level).toHaveText('100%');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(level).toHaveText('120%');
    await level.click();
    await expect(level).toHaveText('100%');

    await drawRect(page, 100, 100, 160, 140);
    await page.getByRole('button', { name: 'Zoom to fit' }).click();
    // A small shape is fitted but never blown up past 200%
    await expect(level).toHaveText('200%');
  });

  test('a drag is a single undo step', async ({ page }) => {
    await drawRect(page, 200, 200, 320, 280);
    const [rect] = await hooks.elements(page);
    await dragFrom(page, 260, 240, 460, 340);
    await expect.poll(async () => (await hooks.elements(page))[0].x).toBeGreaterThan(rect.x + 150);

    await page.keyboard.press(`${mod}+z`);
    await expect.poll(async () => (await hooks.elements(page))[0]?.x).toBe(rect.x);
    await page.keyboard.press(`${mod}+z`);
    await expect.poll(async () => (await hooks.elements(page)).length).toBe(0);
    await page.keyboard.press(`${mod}+Shift+z`);
    await expect.poll(async () => (await hooks.elements(page)).length).toBe(1);
  });

  test('arrow keys nudge the selection; Shift nudges by 10', async ({ page }) => {
    await drawRect(page, 200, 200, 300, 260);
    const [rect] = await hooks.elements(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(async () => (await hooks.elements(page))[0].x).toBe(rect.x + 2);
    expect((await hooks.elements(page))[0].y).toBe(rect.y + 10);
    // All three nudges undo as one step
    await page.keyboard.press(`${mod}+z`);
    await expect.poll(async () => (await hooks.elements(page))[0].x).toBe(rect.x);
  });

  test('context menu reorders overlapping shapes', async ({ page }) => {
    await drawRect(page, 200, 200, 320, 300); // bottom
    await drawRect(page, 260, 240, 380, 340); // top
    const [bottom, top] = await hooks.elements(page);

    // Clicking the overlap selects the topmost shape
    const box = await canvasBox(page);
    await page.mouse.click(box.x + 290, box.y + 270);
    await expect.poll(() => hooks.selected(page)).toEqual([top.id]);

    await rightClick(page, 290, 270);
    const menu = page.getByRole('menu', { name: 'Canvas actions' });
    await menu.getByRole('menuitem', { name: /Send to back/ }).click();
    await expect(menu).toHaveCount(0);

    await page.keyboard.press('Escape');
    await page.mouse.click(box.x + 290, box.y + 270);
    await expect.poll(() => hooks.selected(page)).toEqual([bottom.id]);
  });

  test('locked shapes cannot be moved or deleted until unlocked', async ({ page }) => {
    await drawRect(page, 200, 200, 300, 280);
    const [rect] = await hooks.elements(page);

    await rightClick(page, 250, 240);
    await page.getByRole('menuitem', { name: /^Lock/ }).click();
    await expect.poll(async () => (await hooks.elements(page))[0].isLocked).toBe(true);

    await dragFrom(page, 250, 240, 450, 400);
    expect((await hooks.elements(page))[0].x).toBe(rect.x);
    await page.keyboard.press('Delete');
    expect(await hooks.elements(page)).toHaveLength(1);

    await rightClick(page, 250, 240);
    await page.getByRole('menuitem', { name: /^Unlock/ }).click();
    await dragFrom(page, 250, 240, 350, 240);
    await expect.poll(async () => (await hooks.elements(page))[0].x).toBeGreaterThan(rect.x + 50);
  });

  test('deleting a labelled shape removes its label too', async ({ page }) => {
    await drawRect(page, 200, 200, 360, 300);
    const box = await canvasBox(page);
    await page.mouse.dblclick(box.x + 280, box.y + 250);
    await page.keyboard.type('Billing');
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await hooks.elements(page)).map((e) => e.type).sort())
      .toEqual(['rectangle', 'text']);

    await page.mouse.click(box.x + 205, box.y + 205);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await hooks.elements(page)).length).toBe(0);
  });

  test('copy/paste places the copy at the cursor, with its label', async ({ page }) => {
    await drawRect(page, 200, 200, 300, 260);
    const box = await canvasBox(page);
    await page.mouse.dblclick(box.x + 250, box.y + 230);
    await page.keyboard.type('Cache');
    await page.keyboard.press('Enter');
    await page.mouse.click(box.x + 205, box.y + 205);

    await page.keyboard.press(`${mod}+c`);
    await page.mouse.move(box.x + 600, box.y + 450);
    await page.keyboard.press(`${mod}+v`);

    await expect.poll(async () => (await hooks.elements(page)).length).toBe(4);
    const rects = (await hooks.elements(page)).filter((e) => e.type === 'rectangle');
    const pasted = rects.find((r) => r.x > 400)!;
    // Centered on the cursor
    expect(pasted.x + pasted.width / 2).toBeCloseTo(600, -1);
    const labels = (await hooks.elements(page)).filter((e) => e.type === 'text');
    expect(labels.map((l) => l.containerId).sort()).toEqual(rects.map((r) => r.id).sort());
  });

  test('exports a PNG that the browser downloads', async ({ page }) => {
    await drawRect(page, 200, 200, 320, 280);
    await page.getByRole('button', { name: 'Export' }).click();
    await page.locator('select').first().selectOption('png');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /^Export$/ }).last().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    const path = await download.path();
    const fs = await import('node:fs');
    const bytes = fs.readFileSync(path!);
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(bytes.length).toBeGreaterThan(500);
  });

  test('editing flows produce no console errors', async ({ page }) => {
    const errors = collectErrors(page);
    await drawRect(page, 150, 150, 260, 230);
    await rightClick(page, 200, 190);
    await page.getByRole('menuitem', { name: /Duplicate/ }).click();
    await page.keyboard.press(`${mod}+z`);
    await page.keyboard.press('Shift+1');
    expect(errors).toEqual([]);
  });
});

import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  groupIds: string[];
};
type Hooks = {
  getActiveElements: () => El[];
  getSelectedIds: () => string[];
  getViewport: () => { zoom: number; scrollX: number; scrollY: number };
};
const hooks = <T>(page: Page, fn: (h: Hooks) => T) =>
  page.evaluate(
    (src) =>
      new Function('h', `return (${src})(h)`)(
        (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__,
      ),
    fn.toString(),
  ) as Promise<T>;
const shapes = (page: Page) =>
  hooks(page, (h) => h.getActiveElements().filter((e) => e.type !== 'text'));
const selected = (page: Page) => hooks(page, (h) => h.getSelectedIds());
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function canvasBox(page: Page) {
  return (await page.locator('canvas').nth(1).boundingBox())!;
}
async function drawBox(page: Page, x: number, y: number) {
  const b = await canvasBox(page);
  await page.keyboard.press('r');
  await page.mouse.move(b.x + x, b.y + y);
  await page.mouse.down();
  await page.mouse.move(b.x + x + 120, b.y + y + 60, { steps: 4 });
  await page.mouse.up();
}

test.describe('Keyboard, undo and paste', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('in the context menu, arrow keys move between items and Enter runs one; the shape stays put', async ({
    page,
  }) => {
    await drawBox(page, 200, 200);
    const [box] = await shapes(page);
    const b = await canvasBox(page);
    await page.mouse.click(b.x + 260, b.y + 230, { button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect((await shapes(page))[0].x).toBe(box.x);
    // Walk to "Duplicate" and run it
    const items = menu.getByRole('menuitem');
    const names = await items.allTextContents();
    const target = names.findIndex((n) => n.startsWith('Duplicate'));
    await items.nth(target).focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect.poll(async () => (await shapes(page)).length).toBe(2);
  });

  test('undo of a delete brings the shape back selected', async ({ page }) => {
    await drawBox(page, 200, 200);
    const [box] = await shapes(page);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await shapes(page)).length).toBe(0);
    await page.keyboard.press(`${mod}+z`);
    await expect.poll(() => selected(page)).toEqual([box.id]);
  });

  test('paste lands where the pointer is now, after scrolling; again steps along', async ({
    page,
  }) => {
    await drawBox(page, 200, 200);
    await page.keyboard.press(`${mod}+c`);
    const b = await canvasBox(page);
    // Scroll far away, then paste under the pointer
    await page.mouse.move(b.x + 500, b.y + 300);
    await page.keyboard.down('Shift');
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 300);
    await page.keyboard.up('Shift');
    await page.mouse.move(b.x + 500, b.y + 300);
    await page.keyboard.press(`${mod}+v`);
    const vp = await hooks(page, (h) => h.getViewport());
    const pasted = (await shapes(page)).at(-1)!;
    const centreOnScreen = (pasted.x + pasted.width / 2) * vp.zoom + vp.scrollX;
    expect(Math.abs(centreOnScreen - 500)).toBeLessThan(5);
    await page.keyboard.press(`${mod}+v`);
    const again = (await shapes(page)).at(-1)!;
    expect(again.x - pasted.x).toBeCloseTo(20 / vp.zoom, 0);
  });

  test('Escape leaves a group entered with Ctrl/Cmd+click, selecting the whole group', async ({
    page,
  }) => {
    await drawBox(page, 100, 100);
    await drawBox(page, 300, 100);
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.press(`${mod}+g`);
    await page.keyboard.press('Escape');
    const b = await canvasBox(page);
    await page.keyboard.down(mod);
    await page.mouse.click(b.x + 160, b.y + 130);
    await page.keyboard.up(mod);
    expect(await selected(page)).toHaveLength(1);
    await page.keyboard.press('Escape');
    expect(await selected(page)).toHaveLength(2);
    await page.keyboard.press('Escape');
    expect(await selected(page)).toHaveLength(0);
  });
});

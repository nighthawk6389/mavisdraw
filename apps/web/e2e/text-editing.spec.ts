import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  containerId?: string | null;
};
type Hooks = { getActiveElements: () => El[]; getSelectedIds: () => string[] };
const state = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__;
    return { elements: h.getActiveElements(), selected: h.getSelectedIds() };
  });

async function canvasBox(page: Page) {
  return (await page.locator('canvas').nth(1).boundingBox())!;
}

async function drawBox(page: Page, from: [number, number], to: [number, number]) {
  const b = await canvasBox(page);
  await page.keyboard.press('r');
  await page.mouse.move(b.x + from[0], b.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + to[0], b.y + to[1], { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  return (await state(page)).elements.find((e) => e.type === 'rectangle')!;
}

const editor = (page: Page) => page.getByRole('textbox', { name: 'Text' });

test.describe('Editing text', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('Enter adds a line; Escape finishes; a long label makes its box grow', async ({ page }) => {
    const box = await drawBox(page, [200, 200], [320, 260]);
    const b = await canvasBox(page);
    await page.mouse.dblclick(b.x + 260, b.y + 230);
    await expect(editor(page)).toBeVisible();
    // The editor sits in the middle of the box, as the label is drawn
    const frame = (await editor(page).boundingBox())!;
    expect(Math.abs(frame.y + frame.height / 2 - (b.y + 230))).toBeLessThan(6);

    await page.keyboard.type('Payments');
    await page.keyboard.press('Enter');
    await page.keyboard.type('service that talks to every bank we work with');
    await expect(editor(page)).toBeVisible(); // still editing
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);

    const { elements, selected } = await state(page);
    const label = elements.find((e) => e.type === 'text')!;
    expect(label.text).toBe('Payments\nservice that talks to every bank we work with');
    const grown = elements.find((e) => e.id === box.id)!;
    expect(grown.height).toBeGreaterThan(box.height);
    // About its centre: the label didn't jump
    expect(grown.y + grown.height / 2).toBeCloseTo(box.y + box.height / 2, 0);
    // The box is what's selected, not its label
    expect(selected).toEqual([box.id]);
  });

  test('double-clicking empty canvas starts text there, and typing goes into it', async ({
    page,
  }) => {
    const b = await canvasBox(page);
    await page.mouse.dblclick(b.x + 400, b.y + 300);
    await expect(editor(page)).toBeVisible();
    // Letters that are also tool shortcuts (r, d, e…) are typed, not tools
    await page.keyboard.type('redo');
    await page.keyboard.press('Escape');
    const text = (await state(page)).elements.find((e) => e.type === 'text')!;
    expect(text.text).toBe('redo');
    expect(text.x).toBeCloseTo(400, -1);
  });

  test('the Text tool on a shape edits its label instead of adding text on top', async ({
    page,
  }) => {
    const box = await drawBox(page, [200, 200], [320, 260]);
    const b = await canvasBox(page);
    await page.keyboard.press('t');
    await page.mouse.click(b.x + 260, b.y + 230);
    await page.keyboard.type('API');
    await page.keyboard.press('Escape');
    const texts = (await state(page)).elements.filter((e) => e.type === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0].containerId).toBe(box.id);
  });

  test('pasting brings in the words, not another page’s formatting', async ({ page }) => {
    const b = await canvasBox(page);
    await page.mouse.dblclick(b.x + 400, b.y + 300);
    await expect(editor(page)).toBeVisible();
    await editor(page).evaluate((el) => {
      const data = new DataTransfer();
      data.setData('text/html', '<b style="font-size:48px;color:red">Big</b>');
      data.setData('text/plain', 'Big');
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    expect(await editor(page).innerHTML()).not.toContain('<b');
    await page.keyboard.press('Escape');
    expect((await state(page)).elements.find((e) => e.type === 'text')!.text).toBe('Big');
  });

  test('Enter while an input method is composing is left to it', async ({ page }) => {
    const b = await canvasBox(page);
    await page.mouse.dblclick(b.x + 400, b.y + 300);
    await page.keyboard.type('nihon');
    await editor(page).evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await expect(editor(page)).toBeVisible();
    // Ctrl/Cmd+Enter finishes too
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await expect(editor(page)).toHaveCount(0);
  });
});

import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

/**
 * Smaller interaction gaps: connector points line up with shapes, a click
 * on a connection dot selects its shape, deep select into groups, and
 * scaling a selection with a turned shape.
 */

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  points?: [number, number][];
};
type Hooks = { getActiveElements: () => El[]; getSelectedIds: () => string[] };
const state = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__;
    return { elements: h.getActiveElements(), selected: h.getSelectedIds() };
  });
const byId = async (page: Page, id: string) =>
  (await state(page)).elements.find((e) => e.id === id)!;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function box(page: Page) {
  return (await page.locator('canvas').nth(1).boundingBox())!;
}

async function drag(page: Page, from: [number, number], to: [number, number], steps = 8) {
  const b = await box(page);
  await page.mouse.move(b.x + from[0], b.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + to[0], b.y + to[1], { steps });
  await page.mouse.up();
}

async function draw(page: Page, key: string, from: [number, number], to: [number, number]) {
  const before = (await state(page)).elements.length;
  await page.keyboard.press(key);
  await drag(page, from, to, 5);
  await expect.poll(async () => (await state(page)).elements.length).toBe(before + 1);
  return (await state(page)).elements.at(-1)!;
}

test.describe('Snapping and groups', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('an arrow’s loose end lines up with a shape’s centre', async ({ page }) => {
    // A box whose centre is at y = 130
    await draw(page, 'r', [100, 100], [200, 160]);
    const arrow = await draw(page, 'a', [320, 300], [520, 300]);
    await page.keyboard.press('Escape');
    const b = await box(page);
    await page.mouse.click(b.x + 420, b.y + 300);
    // Drag its end up to 3px below the box's centre line: it lines up exactly
    await drag(page, [520, 300], [520, 133], 10);
    const after = await byId(page, arrow.id);
    const end = after.points!.at(-1)!;
    expect(after.y + end[1]).toBe(130);
  });

  test('clicking a shape’s connection dot selects the shape (only a drag draws a connector)', async ({
    page,
  }) => {
    const shape = await draw(page, 'r', [200, 200], [400, 300]);
    await page.keyboard.press('Escape');
    const b = await box(page);
    // Hovering shows the dots; the top one sits on the middle of the top edge
    await page.mouse.move(b.x + 300, b.y + 250);
    await page.mouse.move(b.x + 300, b.y + 201);
    await page.mouse.down();
    await page.mouse.move(b.x + 301, b.y + 202);
    await page.mouse.up();
    const after = await state(page);
    expect(after.selected).toEqual([shape.id]);
    expect(after.elements).toHaveLength(1);
  });

  test('Ctrl/Cmd+click selects one shape inside a group', async ({ page }) => {
    const a = await draw(page, 'r', [100, 100], [200, 160]);
    await draw(page, 'r', [300, 100], [400, 160]);
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.press(`${mod}+g`);
    await page.keyboard.press('Escape');
    const b = await box(page);
    // A plain click selects the group
    await page.mouse.click(b.x + 150, b.y + 130);
    expect((await state(page)).selected).toHaveLength(2);
    await page.keyboard.press('Escape');
    // Ctrl/Cmd+click: just that shape
    await page.keyboard.down(mod);
    await page.mouse.click(b.x + 150, b.y + 130);
    await page.keyboard.up(mod);
    expect((await state(page)).selected).toEqual([a.id]);
  });

  test('a selection with a turned shape scales without shearing it', async ({ page }) => {
    const turned = await draw(page, 'r', [200, 200], [400, 300]);
    const plain = await draw(page, 'r', [500, 200], [600, 260]);
    // Turn the first a quarter: its handle sits 26px above it
    await page.keyboard.press('Escape');
    const b = await box(page);
    await page.mouse.click(b.x + 300, b.y + 205);
    await drag(page, [300, 174], [420, 250]);
    expect((await byId(page, turned.id)).angle).not.toBe(0);

    await page.keyboard.press(`${mod}+a`);
    const before = await byId(page, plain.id);
    // Pull the bottom-right corner much further right than down
    const frameRight = Math.max(600, 300 + 50) + 4;
    const frameBottom = 300 + 50 + 4;
    await drag(page, [frameRight, frameBottom], [frameRight + 200, frameBottom + 20]);
    const after = await byId(page, plain.id);
    // Scaled the same both ways: its proportions are kept
    expect(after.width / after.height).toBeCloseTo(before.width / before.height, 2);
    expect(after.width).toBeGreaterThan(before.width);
  });
});

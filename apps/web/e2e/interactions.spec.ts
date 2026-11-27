import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

/**
 * Core editing interactions — drawing, moving, snapping, resizing,
 * selecting, auto-pan — exercised with real pointer and keyboard input.
 * The editor opens at 100% with no scroll, so canvas coordinates equal
 * offsets from the canvas's top-left corner.
 */

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type Hooks = {
  getActiveElements: () => El[];
  getSelectedIds: () => string[];
  getViewport: () => { zoom: number; scrollX: number; scrollY: number };
};

const hooks = {
  elements: (page: Page) =>
    page.evaluate(() =>
      (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__.getActiveElements(),
    ),
  selected: (page: Page) =>
    page.evaluate(() =>
      (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__.getSelectedIds().sort(),
    ),
  viewport: (page: Page) =>
    page.evaluate(() => (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__.getViewport()),
};

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function canvasBox(page: Page) {
  const box = await page.locator('canvas').last().boundingBox();
  if (!box) throw new Error('no canvas');
  return box;
}

/** Press at (x1,y1), move to (x2,y2) in steps; release unless `hold`. */
async function drag(
  page: Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  options: { steps?: number; hold?: boolean } = {},
) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: options.steps ?? 8 });
  if (!options.hold) await page.mouse.up();
}

async function click(page: Page, x: number, y: number) {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + x, box.y + y);
}

/** Draw a rectangle and return it. Leaves the select tool active. */
async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<El> {
  const before = (await hooks.elements(page)).length;
  await page.keyboard.press('r');
  await drag(page, x1, y1, x2, y2, { steps: 6 });
  await expect.poll(async () => (await hooks.elements(page)).length).toBe(before + 1);
  return (await hooks.elements(page)).at(-1)!;
}

async function element(page: Page, id: string): Promise<El> {
  const el = (await hooks.elements(page)).find((e) => e.id === id);
  if (!el) throw new Error(`no element ${id}`);
  return el;
}

/** Red guide pixels in a vertical line at canvas x on the overlay canvas. */
async function guidePixelsInColumn(page: Page, x: number): Promise<number> {
  return page.evaluate((cx) => {
    const canvas = document.querySelectorAll('canvas')[1] as HTMLCanvasElement;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d')!;
    const data = ctx.getImageData(Math.round(cx * dpr), 0, 1, canvas.height).data;
    let red = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0 && data[i] > 180 && data[i + 1] < 120 && data[i + 2] < 120) red++;
    }
    return red;
  }, x);
}

test.describe('Drawing shapes', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('a click with a shape tool places a default-size shape centred on the pointer', async ({
    page,
  }) => {
    await page.keyboard.press('r');
    await click(page, 400, 300);
    await expect.poll(async () => (await hooks.elements(page)).length).toBe(1);
    const [rect] = await hooks.elements(page);
    expect(rect).toMatchObject({ type: 'rectangle', x: 320, y: 260, width: 160, height: 80 });
    expect(await hooks.selected(page)).toEqual([rect.id]);
    await expect(page.locator('button[title^="Select"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Q keeps the tool for several shapes', async ({ page }) => {
    await page.keyboard.press('e');
    await page.keyboard.press('q');
    await click(page, 200, 200);
    await click(page, 500, 200);
    await expect.poll(async () => (await hooks.elements(page)).length).toBe(2);
    await expect(page.locator('button[title^="Ellipse"]')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('button[title^="Select"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Shift draws a square; Alt draws out from the centre', async ({ page }) => {
    await page.keyboard.press('r');
    await page.keyboard.down('Shift');
    await drag(page, 100, 100, 260, 180);
    await page.keyboard.up('Shift');
    await expect
      .poll(async () => (await hooks.elements(page))[0])
      .toMatchObject({ x: 100, y: 100, width: 160, height: 160 });

    await page.keyboard.press('r');
    await page.keyboard.down('Alt');
    await drag(page, 600, 400, 660, 440);
    await page.keyboard.up('Alt');
    await expect
      .poll(async () => (await hooks.elements(page))[1])
      .toMatchObject({ x: 540, y: 360, width: 120, height: 80 });
  });

  test('Shift draws arrows in 15° steps', async ({ page }) => {
    await page.keyboard.press('a');
    await page.keyboard.down('Shift');
    await drag(page, 100, 300, 400, 312);
    await page.keyboard.up('Shift');
    await expect.poll(async () => (await hooks.elements(page)).length).toBe(1);
    const [arrow] = (await hooks.elements(page)) as unknown as { points: [number, number][] }[];
    expect(arrow.points[1][1]).toBe(0);
  });
});

test.describe('Moving shapes', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('a click with a little jitter never nudges the shape', async ({ page }) => {
    const rect = await drawRect(page, 200, 200, 360, 280);
    await drag(page, 280, 240, 282, 241, { steps: 2 });
    expect(await element(page, rect.id)).toMatchObject({ x: rect.x, y: rect.y });
    // Nothing to undo but the creation itself
    await page.keyboard.press(`${mod}+z`);
    await expect.poll(async () => (await hooks.elements(page)).length).toBe(0);
  });

  test('Shift locks the move to one axis — also when pressed mid-drag', async ({ page }) => {
    const rect = await drawRect(page, 200, 200, 360, 280);
    await page.keyboard.down('Shift');
    await drag(page, 280, 240, 433, 261);
    await page.keyboard.up('Shift');
    await expect.poll(async () => element(page, rect.id)).toMatchObject({ x: rect.x + 153, y: rect.y });

    // Pressing Shift while holding still applies at once
    await drag(page, 433, 240, 433 + 21, 240 + 140, { hold: true });
    await expect.poll(async () => (await element(page, rect.id)).x).toBe(rect.x + 153 + 21);
    await page.keyboard.down('Shift');
    await expect.poll(async () => (await element(page, rect.id)).x).toBe(rect.x + 153);
    await page.keyboard.up('Shift');
    await page.mouse.up();
  });

  test('Alt-drag leaves the original and drops a copy, undone in one step', async ({ page }) => {
    const rect = await drawRect(page, 200, 200, 360, 280);
    await page.keyboard.down('Alt');
    await drag(page, 280, 240, 280, 440);
    await page.keyboard.up('Alt');
    await expect.poll(async () => (await hooks.elements(page)).length).toBe(2);
    const copy = (await hooks.elements(page)).find((e) => e.id !== rect.id)!;
    expect(copy).toMatchObject({ x: rect.x, y: rect.y + 200, width: rect.width });
    expect(await element(page, rect.id)).toMatchObject({ x: rect.x, y: rect.y });
    expect(await hooks.selected(page)).toEqual([copy.id]);

    await page.keyboard.press(`${mod}+z`);
    await expect.poll(async () => (await hooks.elements(page)).length).toBe(1);
  });

  test('Alt+Arrow puts a copy right next to the selection', async ({ page }) => {
    const rect = await drawRect(page, 200, 200, 360, 280);
    await page.keyboard.press('Alt+ArrowRight');
    await expect.poll(async () => (await hooks.elements(page)).length).toBe(2);
    const copy = (await hooks.elements(page)).find((e) => e.id !== rect.id)!;
    expect(copy).toMatchObject({ x: rect.x + rect.width + 40, y: rect.y });
    expect(await hooks.selected(page)).toEqual([copy.id]);
  });

  test('Escape mid-drag puts the shape back', async ({ page }) => {
    const rect = await drawRect(page, 200, 200, 360, 280);
    await drag(page, 280, 240, 480, 400, { hold: true });
    await expect.poll(async () => (await element(page, rect.id)).x).toBe(rect.x + 200);
    await page.keyboard.press('Escape');
    await expect.poll(async () => element(page, rect.id)).toMatchObject({ x: rect.x, y: rect.y });
    await page.mouse.up();
    expect(await element(page, rect.id)).toMatchObject({ x: rect.x, y: rect.y });
    // The cancelled drag left nothing to undo
    await page.keyboard.press(`${mod}+z`);
    await expect.poll(async () => (await hooks.elements(page)).length).toBe(0);
  });

  test('dragging to the edge of the canvas pans the view and the shape follows', async ({
    page,
  }) => {
    const rect = await drawRect(page, 300, 300, 400, 360);
    const box = await canvasBox(page);
    const before = await hooks.viewport(page);
    // Hold the shape just inside the right edge
    await drag(page, 350, 330, box.width - 6, 330, { hold: true });
    await expect.poll(async () => (await hooks.viewport(page)).scrollX).toBeLessThan(before.scrollX - 100);
    await page.mouse.up();
    const moved = await element(page, rect.id);
    // The shape travelled further than the pointer did on screen
    expect(moved.x - rect.x).toBeGreaterThan(box.width - 6 - 350 + 100);
    // Released away from the edge: scrolling stops
    const settled = (await hooks.viewport(page)).scrollX;
    await page.waitForTimeout(300);
    expect((await hooks.viewport(page)).scrollX).toBe(settled);
  });
});

test.describe('Smart guides and snapping', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('a shape dropped near another’s edge lines up exactly, with a guide while dragging', async ({
    page,
  }) => {
    const a = await drawRect(page, 100, 100, 260, 180);
    const b = await drawRect(page, 400, 300, 480, 360);
    // Bring b's left edge to 3px right of a's left edge
    await drag(page, 440, 330, 440 - (b.x - a.x) + 3, 330, { hold: true });
    await expect.poll(async () => (await element(page, b.id)).x).toBe(a.x);
    // The guide is drawn along the shared edge while the button is down
    await expect.poll(() => guidePixelsInColumn(page, a.x)).toBeGreaterThan(50);
    await page.mouse.up();
    await expect.poll(() => guidePixelsInColumn(page, a.x)).toBe(0);
    expect((await element(page, b.id)).x).toBe(a.x);
  });

  test('holding Ctrl/Cmd places freely', async ({ page }) => {
    const a = await drawRect(page, 100, 100, 260, 180);
    const b = await drawRect(page, 400, 300, 480, 360);
    await page.keyboard.down(mod);
    await drag(page, 440, 330, 440 - (b.x - a.x) + 3, 330);
    await page.keyboard.up(mod);
    await expect.poll(async () => (await element(page, b.id)).x).toBe(a.x + 3);
  });

  test('equal spacing: a third box snaps to repeat the gap of a row', async ({ page }) => {
    const a = await drawRect(page, 100, 100, 200, 160);
    const b = await drawRect(page, 300, 100, 400, 160);
    const c = await drawRect(page, 600, 300, 700, 360);
    const gap = b.x - (a.x + a.width);
    // Drop c roughly one gap after b (4px off), in the same row
    const targetX = b.x + b.width + gap + 4;
    await drag(page, 650, 330, 650 + (targetX - c.x), 330 - (c.y - a.y) + 2);
    await expect
      .poll(async () => element(page, c.id))
      .toMatchObject({ x: b.x + b.width + gap, y: a.y });
  });

  test('resizing snaps the dragged edge to other shapes', async ({ page }) => {
    const target = await drawRect(page, 500, 100, 560, 160);
    const rect = await drawRect(page, 200, 300, 400, 400);
    // Right-edge handle (middle-right), drawn 4px outside the shape
    const hx = rect.x + rect.width + 4;
    const hy = rect.y + rect.height / 2;
    await drag(page, hx, hy, target.x + 4 + 5, hy);
    await expect.poll(async () => (await element(page, rect.id)).width).toBe(target.x - rect.x);
  });

  test('snap to grid (context menu) puts moved shapes on grid lines', async ({ page }) => {
    const rect = await drawRect(page, 203, 207, 363, 287);
    const box = await canvasBox(page);
    await page.mouse.click(box.x + 700, box.y + 500, { button: 'right' });
    await page.getByRole('menuitemcheckbox', { name: /Snap to grid/ }).click();
    await drag(page, rect.x + 20, rect.y + 20, rect.x + 20 + 51, rect.y + 20 + 32);
    const moved = await element(page, rect.id);
    expect(moved.x % 20).toBe(0);
    expect(moved.y % 20).toBe(0);
  });
});

test.describe('Resizing', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  // Corner handles sit on the selection outline, 4px outside the shape
  test('Alt resizes from the centre, Shift keeps proportions', async ({ page }) => {
    const rect = await drawRect(page, 200, 200, 400, 300);
    await page.keyboard.down('Alt');
    await drag(page, 404, 304, 444, 324);
    await page.keyboard.up('Alt');
    await expect
      .poll(async () => element(page, rect.id))
      .toMatchObject({ x: 160, y: 180, width: 280, height: 140 });

    await page.keyboard.down('Shift');
    await drag(page, 444, 324, 724, 334);
    await page.keyboard.up('Shift');
    // Width grew by 280 (×2), height follows
    await expect
      .poll(async () => element(page, rect.id))
      .toMatchObject({ x: 160, y: 180, width: 560, height: 280 });
  });

  test('resizing a multi-selection scales every shape and the gaps between them', async ({
    page,
  }) => {
    const a = await drawRect(page, 200, 200, 300, 260);
    const b = await drawRect(page, 400, 300, 500, 360);
    await page.keyboard.press(`${mod}+a`);
    // Frame (200,200)–(500,360); pull its bottom-right handle to double the size
    await drag(page, 504, 364, 504 + 300, 364 + 160);
    await expect
      .poll(async () => element(page, b.id))
      .toMatchObject({ x: 600, y: 400, width: 200, height: 120 });
    expect(await element(page, a.id)).toMatchObject({ x: 200, y: 200, width: 200, height: 120 });
    // One undo step for the whole resize
    await page.keyboard.press(`${mod}+z`);
    await expect.poll(async () => element(page, b.id)).toMatchObject({ x: b.x, width: b.width });
    expect(await element(page, a.id)).toMatchObject({ x: a.x, width: a.width });
  });

  test('dragging a handle past the opposite edge flips instead of getting stuck', async ({
    page,
  }) => {
    const rect = await drawRect(page, 200, 200, 400, 300);
    await drag(page, 404, 304, 104, 154);
    await expect
      .poll(async () => element(page, rect.id))
      .toMatchObject({ x: 100, y: 150, width: 100, height: 50 });
  });
});

test.describe('Rotating', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  // The rotation handle sits 22px above the selection outline (itself 4px out)
  test('the handle above the selection turns the shape; one undo step', async ({ page }) => {
    const rect = await drawRect(page, 200, 200, 400, 300);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const box = await canvasBox(page);
    await page.mouse.move(box.x + cx, box.y + rect.y - 26);
    await expect(page.locator('canvas').last()).toHaveCSS('cursor', 'grab');

    // A quarter turn clockwise: from straight above the centre to its right
    await drag(page, cx, rect.y - 26, cx + 120, cy);
    await expect
      .poll(async () => ((await element(page, rect.id)) as El & { angle: number }).angle)
      .toBeCloseTo(Math.PI / 2, 5);
    // It turned in place
    expect(await element(page, rect.id)).toMatchObject({ x: rect.x, y: rect.y, width: rect.width });

    await page.keyboard.press(`${mod}+z`);
    await expect
      .poll(async () => ((await element(page, rect.id)) as El & { angle: number }).angle)
      .toBe(0);
  });

  test('Shift turns in 15° steps', async ({ page }) => {
    const rect = await drawRect(page, 200, 200, 400, 300);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    await page.keyboard.down('Shift');
    // atan2(-40, 100) ≈ -21.8° from "up" is +68.2° → snaps to 75°
    await drag(page, cx, rect.y - 26, cx + 100, cy - 40);
    await page.keyboard.up('Shift');
    await expect
      .poll(async () => ((await element(page, rect.id)) as El & { angle: number }).angle)
      .toBeCloseTo((75 * Math.PI) / 180, 5);
  });
});

test.describe('Selecting', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('the marquee selects live; Ctrl/Cmd needs shapes fully inside', async ({ page }) => {
    const a = await drawRect(page, 200, 200, 300, 260);
    const b = await drawRect(page, 400, 200, 500, 260);
    await page.keyboard.press('Escape');
    await drag(page, 150, 150, 250, 300, { hold: true });
    // Selected before the button is released
    await expect.poll(() => hooks.selected(page)).toEqual([a.id]);
    const box = await canvasBox(page);
    await page.mouse.move(box.x + 450, box.y + 300, { steps: 4 });
    await expect.poll(() => hooks.selected(page)).toEqual([a.id, b.id].sort());
    await page.keyboard.down(mod);
    await expect.poll(() => hooks.selected(page)).toEqual([a.id]);
    await page.mouse.up();
    await page.keyboard.up(mod);
    expect(await hooks.selected(page)).toEqual([a.id]);
  });

  test('Shift-click toggles a shape out of the selection', async ({ page }) => {
    const a = await drawRect(page, 200, 200, 300, 260);
    const b = await drawRect(page, 400, 200, 500, 260);
    await page.keyboard.press(`${mod}+a`);
    await expect.poll(() => hooks.selected(page)).toEqual([a.id, b.id].sort());
    const box = await canvasBox(page);
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + 250, box.y + 230);
    await page.keyboard.up('Shift');
    await expect.poll(() => hooks.selected(page)).toEqual([b.id]);
  });

  test('dragging empty space inside the selection moves everything selected', async ({ page }) => {
    const a = await drawRect(page, 200, 200, 300, 260);
    const b = await drawRect(page, 400, 200, 500, 260);
    await page.keyboard.press(`${mod}+a`);
    // (350, 230) is between the shapes, inside their selection frame
    await drag(page, 350, 230, 350, 330);
    await expect.poll(async () => (await element(page, a.id)).y).toBe(a.y + 100);
    expect((await element(page, b.id)).y).toBe(b.y + 100);
    expect(await hooks.selected(page)).toEqual([a.id, b.id].sort());
  });
});

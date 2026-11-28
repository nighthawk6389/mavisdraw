import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

/** The eraser (X): drag over what should go, release, and it's gone in one undo step. */

type El = { id: string; type: string; x: number; y: number; width: number; height: number };
const elements = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __MAVISDRAW__: { getActiveElements: () => El[] } }
    ).__MAVISDRAW__.getActiveElements(),
  );
const types = async (page: Page) => (await elements(page)).map((e) => e.type).sort();
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function canvasBox(page: Page) {
  return (await page.locator('canvas').nth(1).boundingBox())!;
}

async function drag(page: Page, from: [number, number], to: [number, number], steps = 12) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps });
}

async function draw(page: Page, key: string, from: [number, number], to: [number, number]) {
  await page.keyboard.press(key);
  await drag(page, from, to, 5);
  await page.mouse.up();
}

test.describe('Eraser', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
    // A box, a circle, and a scribble
    await draw(page, 'r', [100, 100], [260, 200]);
    await draw(page, 'e', [400, 100], [520, 200]);
    await draw(page, 'p', [100, 320], [300, 330]);
    await page.keyboard.press('Escape');
    expect(await types(page)).toEqual(['ellipse', 'freedraw', 'rectangle']);
  });

  test('erases what the stroke crosses on release, and one undo brings it all back', async ({
    page,
  }) => {
    await page.keyboard.press('x');
    // Down through the box's left edge, then across the scribble
    await drag(page, [100, 80], [100, 330]);
    await page.mouse.move((await canvasBox(page)).x + 320, (await canvasBox(page)).y + 330, {
      steps: 10,
    });
    // Nothing's gone until release
    expect(await types(page)).toEqual(['ellipse', 'freedraw', 'rectangle']);
    await page.mouse.up();
    expect(await types(page)).toEqual(['ellipse']);

    await page.keyboard.press(`${mod}+z`);
    expect(await types(page)).toEqual(['ellipse', 'freedraw', 'rectangle']);
  });

  test('brushing through an empty shape’s middle leaves it; Escape puts everything back', async ({
    page,
  }) => {
    await page.keyboard.press('x');
    await drag(page, [180, 120], [180, 180]);
    await page.mouse.up();
    expect(await types(page)).toEqual(['ellipse', 'freedraw', 'rectangle']);

    // Across the circle's outline, then changing one's mind
    await drag(page, [380, 150], [540, 150]);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await types(page)).toEqual(['ellipse', 'freedraw', 'rectangle']);
  });

  test('Alt spares what it passes over again; a shape’s label goes with it', async ({ page }) => {
    // Label the box
    const box = await canvasBox(page);
    await page.mouse.dblclick(box.x + 180, box.y + 150);
    await page.keyboard.type('API');
    await page.keyboard.press('Escape');
    expect(await types(page)).toEqual(['ellipse', 'freedraw', 'rectangle', 'text']);

    await page.keyboard.press('x');
    // Over the box's edge and the circle's…
    await drag(page, [80, 150], [540, 150], 30);
    // …then back over the circle with Alt: it's spared
    await page.keyboard.down('Alt');
    await page.mouse.move(box.x + 380, box.y + 150, { steps: 10 });
    await page.keyboard.up('Alt');
    await page.mouse.up();
    expect(await types(page)).toEqual(['ellipse', 'freedraw']);
  });
});

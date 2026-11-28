import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: [number, number][];
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
};
const elements = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __MAVISDRAW__: { getActiveElements: () => El[] } }).__MAVISDRAW__
      .getActiveElements()
      .filter((e) => e.type !== 'text'),
  );

async function canvasBox(page: Page) {
  return (await page.locator('canvas').nth(1).boundingBox())!;
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const b = await canvasBox(page);
  await page.mouse.move(b.x + from[0], b.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + to[0], b.y + to[1], { steps: 8 });
  await page.mouse.up();
}

test.describe('Connectors', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('an arrow drawn from one box into the middle of another joins them, and follows them', async ({
    page,
  }) => {
    await page.keyboard.press('r');
    await drag(page, [100, 100], [260, 180]);
    await page.keyboard.press('r');
    await drag(page, [500, 100], [660, 180]);
    const [a, b] = await elements(page);

    await page.keyboard.press('a');
    await drag(page, [180, 140], [580, 140]);
    const arrow = (await elements(page)).find((e) => e.type === 'arrow')!;
    expect(arrow.startBinding?.elementId).toBe(a.id);
    expect(arrow.endBinding?.elementId).toBe(b.id);
    // Its ends sit on the outlines, not in the middles
    const end = arrow.points!.at(-1)!;
    expect(arrow.x + end[0]).toBeCloseTo(500, 0);

    // Moving B takes the arrow's end with it
    await page.keyboard.press('Escape');
    await drag(page, [580, 170], [580, 370]);
    const moved = (await elements(page)).find((e) => e.type === 'arrow')!;
    const movedEnd = moved.points!.at(-1)!;
    expect(moved.y + movedEnd[1]).toBeGreaterThan(250);
  });

  test('grabbing a box by the middle of its edge moves it; the dot just outside draws a connector', async ({
    page,
  }) => {
    await page.keyboard.press('r');
    await drag(page, [100, 100], [260, 180]);
    await page.keyboard.press('Escape');
    const [box] = await elements(page);

    // The bottom edge, right at its middle
    await drag(page, [180, 180], [180, 280]);
    let all = await elements(page);
    expect(all).toHaveLength(1);
    expect(all[0].y).toBe(box.y + 100);

    // The dot 14px below that edge starts a connector
    await page.keyboard.press('Escape');
    const b = await canvasBox(page);
    await page.mouse.move(b.x + 180, b.y + 330);
    await drag(page, [180, 280 + 14], [180, 420]);
    all = await elements(page);
    expect(all.map((e) => e.type).sort()).toEqual(['arrow', 'rectangle']);
    expect(all.find((e) => e.type === 'arrow')!.startBinding?.elementId).toBe(box.id);
  });
});

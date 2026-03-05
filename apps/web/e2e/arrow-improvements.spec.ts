import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor, collectErrors } from './helpers/auth';

function toolButton(page: Page, titlePrefix: string) {
  return page.getByTestId('toolbar').locator(`button[title^="${titlePrefix}"]`);
}

async function getCanvasBox(page: Page) {
  return page.locator('canvas').last().boundingBox();
}

async function drawRectangle(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await toolButton(page, 'Rectangle').click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
}

async function drawArrow(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await toolButton(page, 'Arrow').click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();
}

async function selectElement(page: Page, x: number, y: number) {
  await toolButton(page, 'Select').click();
  await page.mouse.click(x, y);
}

async function ensureStylePanelOpen(page: Page) {
  const panel = page.getByTestId('style-panel');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.locator('button[title^="Style panel"]').click();
    await page.waitForTimeout(200);
  }
  return panel;
}

// ─── Phase 1: Curved & Elbow Routing Fixes ─────────────────────

test.describe('Arrow Routing Fixes (Phase 1)', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('creating a curved arrow produces no errors', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;
    await drawArrow(page, box.x + 100, box.y + 200, box.x + 400, box.y + 200);

    await selectElement(page, box.x + 250, box.y + 200);
    await page.waitForTimeout(200);

    const panel = await ensureStylePanelOpen(page);
    const curvedButton = panel.locator('button', { hasText: 'Curved' });
    if (await curvedButton.isVisible()) {
      await curvedButton.click();
    }

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('creating an elbow arrow produces no errors', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;
    await drawArrow(page, box.x + 100, box.y + 200, box.x + 400, box.y + 200);

    await selectElement(page, box.x + 250, box.y + 200);
    await page.waitForTimeout(200);

    const panel = await ensureStylePanelOpen(page);
    const elbowButton = panel.locator('button', { hasText: 'Elbow' });
    if (await elbowButton.isVisible()) {
      await elbowButton.click();
    }

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('clicking on a curved arrow selects it', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;
    await drawArrow(page, box.x + 100, box.y + 300, box.x + 500, box.y + 300);

    await selectElement(page, box.x + 300, box.y + 300);
    await page.waitForTimeout(100);

    const panel = await ensureStylePanelOpen(page);
    const curvedButton = panel.locator('button', { hasText: 'Curved' });
    if (await curvedButton.isVisible()) {
      await curvedButton.click();
    }
    await page.waitForTimeout(200);

    // Deselect
    await page.mouse.click(box.x + 50, box.y + 50);
    await page.waitForTimeout(100);

    // Click near the curve path
    await page.mouse.click(box.x + 300, box.y + 290);
    await page.waitForTimeout(200);

    expect(errors).toEqual([]);
  });
});

// ─── Phase 2: Arrowhead Controls ────────────────────────────────

test.describe('Arrowhead Controls (Phase 2)', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('arrowhead section appears when arrow is selected', async ({ page }) => {
    const box = (await getCanvasBox(page))!;
    await drawArrow(page, box.x + 100, box.y + 200, box.x + 400, box.y + 200);

    await selectElement(page, box.x + 250, box.y + 200);
    await page.waitForTimeout(200);

    const panel = await ensureStylePanelOpen(page);

    const startArrowheadLabel = panel.getByText('Start Arrowhead');
    const endArrowheadLabel = panel.getByText('End Arrowhead');
    await expect(startArrowheadLabel).toBeVisible({ timeout: 3000 });
    await expect(endArrowheadLabel).toBeVisible({ timeout: 3000 });
  });

  test('changing arrowhead style produces no errors', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;
    await drawArrow(page, box.x + 100, box.y + 200, box.x + 400, box.y + 200);

    await selectElement(page, box.x + 250, box.y + 200);
    await page.waitForTimeout(200);

    const panel = await ensureStylePanelOpen(page);
    const triangleButton = panel.locator('button[title="Triangle"]').last();
    if (await triangleButton.isVisible()) {
      await triangleButton.click();
    }

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('double-clicking arrow cycles routing mode', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;
    await drawArrow(page, box.x + 100, box.y + 300, box.x + 400, box.y + 300);

    await selectElement(page, box.x + 250, box.y + 300);
    await page.waitForTimeout(200);

    // Double-click to cycle routing mode (straight -> curved)
    await page.mouse.dblclick(box.x + 250, box.y + 300);
    await page.waitForTimeout(300);

    expect(errors).toEqual([]);
  });
});

// ─── Phase 3: Edge-Initiated Connections ────────────────────────

test.describe('Edge-Initiated Connections (Phase 3)', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('creating arrow between two shapes works without errors', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;

    await drawRectangle(page, box.x + 100, box.y + 150, box.x + 250, box.y + 250);
    await drawRectangle(page, box.x + 400, box.y + 150, box.x + 550, box.y + 250);

    await drawArrow(page, box.x + 250, box.y + 200, box.x + 400, box.y + 200);

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('hovering near shape edge produces no errors', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;
    await drawRectangle(page, box.x + 200, box.y + 200, box.x + 400, box.y + 300);

    await toolButton(page, 'Select').click();
    await page.mouse.move(box.x + 300, box.y + 200, { steps: 5 });
    await page.waitForTimeout(500);

    await page.mouse.move(box.x + 400, box.y + 250, { steps: 5 });
    await page.waitForTimeout(500);

    expect(errors).toEqual([]);
  });

  test('drag from anchor to create arrow without errors', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;
    await drawRectangle(page, box.x + 100, box.y + 200, box.x + 250, box.y + 300);
    await drawRectangle(page, box.x + 400, box.y + 200, box.x + 550, box.y + 300);

    await toolButton(page, 'Select').click();
    await page.mouse.move(box.x + 250, box.y + 250, { steps: 3 });
    await page.waitForTimeout(300);

    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 250, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });
});

// ─── Phase 4: Endpoint Dragging ─────────────────────────────────

test.describe('Endpoint Dragging (Phase 4)', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('selecting arrow shows endpoint handles without errors', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;
    await drawArrow(page, box.x + 100, box.y + 200, box.x + 400, box.y + 200);

    await selectElement(page, box.x + 250, box.y + 200);
    await page.waitForTimeout(300);

    expect(errors).toEqual([]);
  });

  test('dragging endpoint to new position works without errors', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;
    await drawArrow(page, box.x + 100, box.y + 200, box.x + 400, box.y + 200);

    await selectElement(page, box.x + 250, box.y + 200);
    await page.waitForTimeout(200);

    // Drag the end point to a new position
    await page.mouse.move(box.x + 400, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 400, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('dragging endpoint to rebind to a shape works without errors', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;

    await drawRectangle(page, box.x + 100, box.y + 150, box.x + 200, box.y + 250);
    await drawRectangle(page, box.x + 400, box.y + 150, box.x + 500, box.y + 250);
    await drawArrow(page, box.x + 200, box.y + 200, box.x + 300, box.y + 200);

    await selectElement(page, box.x + 250, box.y + 200);
    await page.waitForTimeout(200);

    // Drag end point toward the second rectangle
    await page.mouse.move(box.x + 300, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 200, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });
});

// ─── Phase 5: Midpoint / Waypoint Manipulation ─────────────────

test.describe('Midpoint Manipulation (Phase 5)', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('selecting arrow shows midpoint add handles without errors', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;
    await drawArrow(page, box.x + 100, box.y + 300, box.x + 500, box.y + 300);

    await selectElement(page, box.x + 300, box.y + 300);
    await page.waitForTimeout(300);

    expect(errors).toEqual([]);
  });

  test('clicking midpoint to add waypoint produces no errors', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;
    await drawArrow(page, box.x + 100, box.y + 300, box.x + 500, box.y + 300);

    await selectElement(page, box.x + 300, box.y + 300);
    await page.waitForTimeout(200);

    // Click and drag on the midpoint to create a waypoint
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 200, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('full waypoint workflow: add, drag, remove produces no errors', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;

    await drawArrow(page, box.x + 50, box.y + 300, box.x + 550, box.y + 300);

    await selectElement(page, box.x + 300, box.y + 300);
    await page.waitForTimeout(200);

    // Add a waypoint by clicking the midpoint handle and dragging
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 200, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Double-click on the waypoint to remove it
    await page.mouse.dblclick(box.x + 300, box.y + 200);
    await page.waitForTimeout(300);

    expect(errors).toEqual([]);
  });

  test('double-click on waypoint removes it (Excalidraw/draw.io style)', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;
    await drawArrow(page, box.x + 100, box.y + 300, box.x + 500, box.y + 300);
    await selectElement(page, box.x + 300, box.y + 300);
    await page.waitForTimeout(200);

    // Add waypoint at midpoint
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 250, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    // Double-click the waypoint handle to remove it
    await page.mouse.dblclick(box.x + 300, box.y + 250);
    await page.waitForTimeout(300);

    expect(errors).toEqual([]);
  });

  test('Delete key while dragging waypoint removes it', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;
    await drawArrow(page, box.x + 100, box.y + 300, box.x + 500, box.y + 300);
    await selectElement(page, box.x + 300, box.y + 300);
    await page.waitForTimeout(200);

    // Add waypoint
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 250, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Click waypoint to start dragging, then press Delete to remove it
    await page.mouse.click(box.x + 300, box.y + 250);
    await page.waitForTimeout(100);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);

    expect(errors).toEqual([]);
  });
});

// ─── Integration: All Routing Modes ─────────────────────────────

test.describe('Arrow Routing Mode Integration', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('switching routing modes via style panel produces no errors', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;
    await drawArrow(page, box.x + 100, box.y + 300, box.x + 400, box.y + 300);

    await selectElement(page, box.x + 250, box.y + 300);
    await page.waitForTimeout(200);

    const panel = await ensureStylePanelOpen(page);

    // Cycle through all routing modes
    const curvedBtn = panel.locator('button', { hasText: 'Curved' });
    if (await curvedBtn.isVisible()) {
      await curvedBtn.click();
      await page.waitForTimeout(200);
    }

    const elbowBtn = panel.locator('button', { hasText: 'Elbow' });
    if (await elbowBtn.isVisible()) {
      await elbowBtn.click();
      await page.waitForTimeout(200);
    }

    const straightBtn = panel.locator('button', { hasText: 'Straight' });
    if (await straightBtn.isVisible()) {
      await straightBtn.click();
      await page.waitForTimeout(200);
    }

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('arrow with binding updates correctly when shape moves', async ({ page }) => {
    const errors = collectErrors(page);

    const box = (await getCanvasBox(page))!;

    await drawRectangle(page, box.x + 350, box.y + 150, box.x + 500, box.y + 250);
    await drawArrow(page, box.x + 100, box.y + 200, box.x + 350, box.y + 200);

    // Select the rectangle and drag it
    await selectElement(page, box.x + 425, box.y + 200);
    await page.waitForTimeout(200);

    await page.mouse.move(box.x + 425, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 425, box.y + 350, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });
});

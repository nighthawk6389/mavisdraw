import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor, collectErrors } from './helpers/auth';

function toolButton(page: Page, titlePrefix: string) {
  return page.getByTestId('toolbar').locator(`button[title^="${titlePrefix}"]`);
}

function getCanvasBox(page: Page) {
  return page.locator('canvas').last().boundingBox();
}

/** Read the current viewport state from the app's exposed test hook. */
function getViewport(page: Page) {
  return page.evaluate(() => (window as any).__MAVISDRAW_GET_VIEWPORT__());
}

// ─── Scroll-to-Zoom (Miro-style) ────────────────────────────────

test.describe('Scroll-to-Zoom', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('scroll down zooms out', async ({ page }) => {
    const box = (await getCanvasBox(page))!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    const before = await getViewport(page);
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);

    const after = await getViewport(page);
    expect(after.zoom).toBeLessThan(before.zoom);
  });

  test('scroll up zooms in', async ({ page }) => {
    const box = (await getCanvasBox(page))!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    const before = await getViewport(page);
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(100);

    const after = await getViewport(page);
    expect(after.zoom).toBeGreaterThan(before.zoom);
  });

  test('multiple scroll steps compound the zoom', async ({ page }) => {
    const box = (await getCanvasBox(page))!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(centerX, centerY);

    // Zoom in 3 times
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(50);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(50);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(100);

    const after = await getViewport(page);
    // 1.1^3 ≈ 1.331
    expect(after.zoom).toBeCloseTo(1.331, 1);
  });

  test('ctrl+scroll uses fine-grained zoom (trackpad pinch)', async ({ page }) => {
    const box = (await getCanvasBox(page))!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    const before = await getViewport(page);
    await page.mouse.move(centerX, centerY);

    // Simulate ctrl+wheel (trackpad pinch gesture)
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 50);
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);

    const after = await getViewport(page);
    expect(after.zoom).toBeLessThan(before.zoom);
    // Fine-grained: factor = 1 - 50*0.01 = 0.5, clamped to 0.5 → zoom = 0.5
    expect(after.zoom).toBeCloseTo(0.5, 1);
  });

  test('zoom does not produce console errors', async ({ page }) => {
    const errors = collectErrors(page);
    const box = (await getCanvasBox(page))!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, 100);

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('canvas remains functional after zooming', async ({ page }) => {
    const box = (await getCanvasBox(page))!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Zoom in
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(100);

    // Create a rectangle after zooming
    await toolButton(page, 'Rectangle').click();
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 });
    await page.mouse.up();

    // Tool should reset to select (element was created successfully)
    await expect(toolButton(page, 'Select')).toHaveClass(/bg-blue-100/);
  });
});

// ─── Right-Click Pan (Miro-style) ───────────────────────────────

test.describe('Right-Click Pan', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('right-click drag pans the canvas', async ({ page }) => {
    const box = (await getCanvasBox(page))!;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    const before = await getViewport(page);

    // Right-click drag
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(startX + 150, startY + 100, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(100);

    const after = await getViewport(page);
    // scrollX should increase by ~150, scrollY by ~100
    expect(after.scrollX).toBeGreaterThan(before.scrollX + 100);
    expect(after.scrollY).toBeGreaterThan(before.scrollY + 50);
  });

  test('right-click pan does not change zoom', async ({ page }) => {
    const box = (await getCanvasBox(page))!;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    const before = await getViewport(page);

    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(startX + 200, startY + 100, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(100);

    const after = await getViewport(page);
    expect(after.zoom).toBe(before.zoom);
  });

  test('right-click pan does not create elements', async ({ page }) => {
    const errors = collectErrors(page);

    // Switch to rectangle tool first
    await toolButton(page, 'Rectangle').click();

    const box = (await getCanvasBox(page))!;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // Right-click drag — should pan, not create a rectangle
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(startX + 150, startY + 100, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(100);

    // Rectangle tool should still be active (no creation happened)
    await expect(toolButton(page, 'Rectangle')).toHaveClass(/bg-blue-100/);

    expect(errors).toEqual([]);
  });

  test('right-click pan does not open context menu', async ({ page }) => {
    const box = (await getCanvasBox(page))!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Right-click on the canvas
    await page.mouse.click(centerX, centerY, { button: 'right' });
    await page.waitForTimeout(200);

    // No context menu should be visible (browser-native context menus are prevented)
    const contextMenu = page.locator('[role="menu"]');
    await expect(contextMenu).toHaveCount(0);
  });

  test('right-click pan does not produce errors', async ({ page }) => {
    const errors = collectErrors(page);
    const box = (await getCanvasBox(page))!;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(startX + 200, startY + 150, { steps: 10 });
    await page.mouse.up({ button: 'right' });

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('canvas remains functional after right-click pan', async ({ page }) => {
    const box = (await getCanvasBox(page))!;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // Pan with right-click
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(startX + 100, startY + 100, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(100);

    // Create a rectangle after panning
    await toolButton(page, 'Rectangle').click();
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 });
    await page.mouse.up();

    await expect(toolButton(page, 'Select')).toHaveClass(/bg-blue-100/);
  });
});

// ─── Combined Zoom + Pan ────────────────────────────────────────

test.describe('Combined Zoom and Pan', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('zoom then pan moves viewport correctly', async ({ page }) => {
    const box = (await getCanvasBox(page))!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Zoom in
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(100);

    const afterZoom = await getViewport(page);

    // Pan with right-click
    await page.mouse.move(centerX, centerY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(centerX + 100, centerY + 50, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(100);

    const afterPan = await getViewport(page);

    // Zoom should not change during pan
    expect(afterPan.zoom).toBe(afterZoom.zoom);
    // Scroll should have changed
    expect(afterPan.scrollX).not.toBe(afterZoom.scrollX);
    expect(afterPan.scrollY).not.toBe(afterZoom.scrollY);
  });

  test('pan then zoom preserves zoom centering', async ({ page }) => {
    const errors = collectErrors(page);
    const box = (await getCanvasBox(page))!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Pan first
    await page.mouse.move(centerX, centerY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(centerX + 200, centerY + 100, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(100);

    // Then zoom
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(100);

    const final = await getViewport(page);
    expect(final.zoom).toBeGreaterThan(1);

    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
  });

  test('element creation works after zoom and pan', async ({ page }) => {
    const errors = collectErrors(page);
    const box = (await getCanvasBox(page))!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Zoom in
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(50);

    // Pan
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(centerX - 100, centerY - 50, { steps: 3 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(50);

    // Create a rectangle
    await toolButton(page, 'Rectangle').click();
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, box.y + 300, { steps: 5 });
    await page.mouse.up();

    await expect(toolButton(page, 'Select')).toHaveClass(/bg-blue-100/);

    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
  });
});

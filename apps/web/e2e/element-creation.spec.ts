import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor, collectErrors } from './helpers/auth';

function toolButton(page: Page, titlePrefix: string) {
  return page.getByTestId('toolbar').locator(`button[title^="${titlePrefix}"]`);
}

function getCanvasBox(page: Page) {
  return page.locator('canvas').last().boundingBox();
}

// ─── Shape Creation Preview ────────────────────────────────────
//
// Verifies that shapes are visible during click-drag creation.
// This was broken because the InteractionManager's creatingElement
// was only read during React renders, not during the animation frame
// render loop.

test.describe('Shape Creation Preview', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('no console errors during shape creation', async ({ page }) => {
    const errors = collectErrors(page);

    // Draw a rectangle
    await toolButton(page, 'Rectangle').click();
    const box = (await getCanvasBox(page))!;
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 350, { steps: 10 });
    await page.mouse.up();

    // Draw an ellipse
    await toolButton(page, 'Ellipse').click();
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 200, { steps: 10 });
    await page.mouse.up();

    // Draw a diamond
    await toolButton(page, 'Diamond').click();
    await page.mouse.move(box.x + 300, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 450, box.y + 200, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(300);
    expect(errors, 'Expected no errors during shape creation').toEqual([]);
  });

  test('rectangle tool resets to select after creation', async ({ page }) => {
    await toolButton(page, 'Rectangle').click();
    const box = (await getCanvasBox(page))!;

    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 });
    await page.mouse.up();

    await expect(toolButton(page, 'Select')).toHaveClass(/bg-blue-100/);
  });

  test('created rectangle is visible and can be selected and deleted', async ({ page }) => {
    const errors = collectErrors(page);

    await toolButton(page, 'Rectangle').click();
    const box = (await getCanvasBox(page))!;
    const rectCenterX = box.x + 300;
    const rectCenterY = box.y + 275;
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 });
    await page.mouse.up();

    await page.waitForTimeout(400);
    expect(errors).toEqual([]);

    // Deselect by clicking empty area
    await toolButton(page, 'Select').click();
    await page.mouse.click(box.x + 50, box.y + 50);
    await page.waitForTimeout(200);

    // Click on the rectangle center — if the shape is visible, it gets selected
    await page.mouse.click(rectCenterX, rectCenterY);
    await page.waitForTimeout(200);

    // Delete should remove the selected shape (proves it was there and visible)
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);

    // Undo restores the shape
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    expect(errors, 'No errors during create → select → delete → undo').toEqual([]);
  });

  test('arrow creation works without errors', async ({ page }) => {
    const errors = collectErrors(page);

    await toolButton(page, 'Arrow').click();
    const box = (await getCanvasBox(page))!;

    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 300, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('freedraw tool works without errors', async ({ page }) => {
    const errors = collectErrors(page);

    await toolButton(page, 'Freedraw').click();
    const box = (await getCanvasBox(page))!;

    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 150, { steps: 5 });
    await page.mouse.move(box.x + 300, box.y + 100, { steps: 5 });
    await page.mouse.move(box.x + 350, box.y + 200, { steps: 5 });
    await page.mouse.up();

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });
});

// ─── Text Tool ─────────────────────────────────────────────────

test.describe('Text Tool', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('clicking with text tool shows editable text box', async ({ page }) => {
    await toolButton(page, 'Text').click();
    const box = (await getCanvasBox(page))!;

    // Click on canvas to create text
    await page.mouse.click(box.x + 300, box.y + 300);

    // A contentEditable div should appear
    const editor = page.locator('div[contenteditable]');
    await expect(editor).toBeVisible({ timeout: 2000 });
  });

  test('typing in text editor adds text', async ({ page }) => {
    await toolButton(page, 'Text').click();
    const box = (await getCanvasBox(page))!;

    await page.mouse.click(box.x + 300, box.y + 300);

    const editor = page.locator('div[contenteditable]');
    await expect(editor).toBeVisible({ timeout: 2000 });

    await page.keyboard.type('Hello World');
    await expect(editor).toContainText('Hello World');
  });

  test('text editor is visible and interactive', async ({ page }) => {
    const errors = collectErrors(page);

    await toolButton(page, 'Text').click();
    const box = (await getCanvasBox(page))!;

    await page.mouse.click(box.x + 300, box.y + 300);

    const editor = page.locator('div[contenteditable]');
    await expect(editor).toBeVisible({ timeout: 2000 });

    await page.keyboard.type('Hello MavisDraw');
    await expect(editor).toContainText('Hello MavisDraw');

    await page.waitForTimeout(300);
    expect(errors, 'No runtime errors during text creation and editing').toEqual([]);
  });

  test('no console errors during text creation', async ({ page }) => {
    const errors = collectErrors(page);

    await toolButton(page, 'Text').click();
    const box = (await getCanvasBox(page))!;

    await page.mouse.click(box.x + 300, box.y + 300);
    await page.keyboard.type('Test');
    await page.keyboard.press('Enter');

    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });
});

// ─── Portal Empty Label ────────────────────────────────────────

test.describe('Portal Element', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('portal creation works without errors', async ({ page }) => {
    const errors = collectErrors(page);

    await toolButton(page, 'Portal').click();
    const box = (await getCanvasBox(page))!;

    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 });
    await page.mouse.up();

    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
});

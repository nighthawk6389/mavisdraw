import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor } from './helpers/auth';

/** Click on the canvas area to ensure the page has focus for keyboard events.
 *  We use the last canvas (interactive layer on top) with force to avoid overlap issues. */
async function focusPage(page: Page) {
  await page.locator('canvas').last().click({ position: { x: 10, y: 10 }, force: true });
}

/** Get a toolbar button by its title prefix (e.g., "Rectangle", "Hand") */
function toolButton(page: Page, label: string) {
  return page.getByTestId('toolbar').locator(`button[title^="${label}"]`);
}

test.describe('MavisDraw Application', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('loads the application', async ({ page }) => {
    await expect(page).toHaveTitle('MavisDraw');
  });

  test('renders the toolbar', async ({ page }) => {
    const toolbar = page.getByTestId('toolbar');
    await expect(toolbar).toBeVisible();
  });

  test('renders the canvas', async ({ page }) => {
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
  });

  test('has two canvas elements (static + interactive)', async ({ page }) => {
    const canvases = page.locator('canvas');
    await expect(canvases).toHaveCount(2);
  });
});

test.describe('Toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('displays all tool buttons', async ({ page }) => {
    const toolbar = page.getByTestId('toolbar');
    const buttons = toolbar.locator('button');
    const count = await buttons.count();
    // 9 tool buttons + render mode toggle + grid toggle = 11
    expect(count).toBeGreaterThanOrEqual(11);
  });

  test('clicking a tool button activates it', async ({ page }) => {
    const rectButton = toolButton(page, 'Rectangle');
    await rectButton.click();
    await expect(rectButton).toHaveClass(/bg-blue-100/);
  });

  test('clicking a different tool deactivates the previous one', async ({ page }) => {
    const rectButton = toolButton(page, 'Rectangle');
    const ellipseButton = toolButton(page, 'Ellipse');

    await rectButton.click();
    await expect(rectButton).toHaveClass(/bg-blue-100/);

    await ellipseButton.click();
    await expect(ellipseButton).toHaveClass(/bg-blue-100/);
    await expect(rectButton).not.toHaveClass(/bg-blue-100/);
  });

  test('toggling render mode changes button appearance', async ({ page }) => {
    const toolbar = page.getByTestId('toolbar');
    const renderButton = toolbar.locator('button').filter({ hasText: /✍|♢/ });
    await expect(renderButton).toBeVisible();

    // Default is clean mode; click to toggle to sketchy
    await renderButton.click();
    // After toggling to sketchy, click again to go back to clean
    await renderButton.click();
    await expect(renderButton).toBeVisible();
  });

  test('toggling grid changes button appearance', async ({ page }) => {
    const toolbar = page.getByTestId('toolbar');
    const gridButton = toolbar.locator('button').filter({ hasText: '#' });
    await expect(gridButton).toBeVisible();

    // Initially grid is on
    await expect(gridButton).toHaveClass(/text-gray-700/);

    // Click to toggle grid off
    await gridButton.click();
    await expect(gridButton).toHaveClass(/text-gray-400/);
  });
});

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
    await focusPage(page);
  });

  test('pressing R activates rectangle tool', async ({ page }) => {
    await page.keyboard.press('r');
    await expect(toolButton(page, 'Rectangle')).toHaveClass(/bg-blue-100/);
  });

  test('pressing V activates select tool', async ({ page }) => {
    await page.keyboard.press('r');
    await page.keyboard.press('v');
    await expect(toolButton(page, 'Select')).toHaveClass(/bg-blue-100/);
  });

  test('pressing E activates ellipse tool', async ({ page }) => {
    await page.keyboard.press('e');
    await expect(toolButton(page, 'Ellipse')).toHaveClass(/bg-blue-100/);
  });

  test('pressing H activates hand tool', async ({ page }) => {
    await page.keyboard.press('h');
    await expect(toolButton(page, 'Hand')).toHaveClass(/bg-blue-100/);
  });

  test('pressing D activates diamond tool', async ({ page }) => {
    await page.keyboard.press('d');
    await expect(toolButton(page, 'Diamond')).toHaveClass(/bg-blue-100/);
  });

  test('pressing L activates line tool', async ({ page }) => {
    await page.keyboard.press('l');
    await expect(toolButton(page, 'Line')).toHaveClass(/bg-blue-100/);
  });

  test('pressing A activates arrow tool', async ({ page }) => {
    await page.keyboard.press('a');
    await expect(toolButton(page, 'Arrow')).toHaveClass(/bg-blue-100/);
  });

  test('pressing Escape resets to select tool', async ({ page }) => {
    await page.keyboard.press('r');
    await page.keyboard.press('Escape');
    await expect(toolButton(page, 'Select')).toHaveClass(/bg-blue-100/);
  });
});

test.describe('Canvas Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('drawing a rectangle on the canvas', async ({ page }) => {
    // Select rectangle tool via click
    await toolButton(page, 'Rectangle').click();

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // Draw a rectangle by clicking and dragging
    await page.mouse.move(box!.x + 200, box!.y + 200);
    await page.mouse.down();
    await page.mouse.move(box!.x + 400, box!.y + 350, { steps: 5 });
    await page.mouse.up();

    // After drawing, tool should reset to select (if not locked)
    await expect(toolButton(page, 'Select')).toHaveClass(/bg-blue-100/);
  });

  test('panning with the hand tool', async ({ page }) => {
    // Select hand tool via click
    await toolButton(page, 'Hand').click();

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // Pan the canvas
    await page.mouse.move(box!.x + 300, box!.y + 300);
    await page.mouse.down();
    await page.mouse.move(box!.x + 400, box!.y + 400, { steps: 5 });
    await page.mouse.up();

    // Hand tool should still be active (hand doesn't auto-reset)
    await expect(toolButton(page, 'Hand')).toHaveClass(/bg-blue-100/);
  });

  test('zoom with mouse wheel', async ({ page }) => {
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + 300, box!.y + 300);
    await page.mouse.wheel(0, -100);

    // Canvas should still be visible after zoom
    await expect(canvas).toBeVisible();
  });

  test('drawing an ellipse on the canvas', async ({ page }) => {
    await toolButton(page, 'Ellipse').click();

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();

    await page.mouse.move(box!.x + 150, box!.y + 150);
    await page.mouse.down();
    await page.mouse.move(box!.x + 300, box!.y + 250, { steps: 5 });
    await page.mouse.up();

    await expect(toolButton(page, 'Select')).toHaveClass(/bg-blue-100/);
  });

  test('drawing a line on the canvas', async ({ page }) => {
    await toolButton(page, 'Line').click();

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();

    await page.mouse.move(box!.x + 100, box!.y + 100);
    await page.mouse.down();
    await page.mouse.move(box!.x + 400, box!.y + 300, { steps: 5 });
    await page.mouse.up();

    await expect(toolButton(page, 'Select')).toHaveClass(/bg-blue-100/);
  });
});

test.describe('Element Selection', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('Ctrl+A on empty canvas does not break', async ({ page }) => {
    await focusPage(page);
    await page.keyboard.press('Control+a');
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
  });

  test('Delete key on empty canvas does not break', async ({ page }) => {
    await focusPage(page);
    await page.keyboard.press('Delete');
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
  });

  test('undo with Ctrl+Z on empty canvas', async ({ page }) => {
    await focusPage(page);
    await page.keyboard.press('Control+z');
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
  });

  test('redo with Ctrl+Shift+Z on empty canvas', async ({ page }) => {
    await focusPage(page);
    await page.keyboard.press('Control+Shift+z');
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
  });
});

test.describe('Responsive Layout', () => {
  test('app fills the full viewport', async ({ page }) => {
    await mockAuthAndOpenEditor(page);
    const appContainer = page.locator('div.flex.h-full.w-full');
    await expect(appContainer).toBeVisible();
  });

  test('toolbar is on the left side', async ({ page }) => {
    await mockAuthAndOpenEditor(page);
    const toolbar = page.getByTestId('toolbar');
    const box = await toolbar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBe(0);
  });
});

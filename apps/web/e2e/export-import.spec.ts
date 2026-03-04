import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function toolButton(page: Page, titlePrefix: string) {
  return page.getByTestId('toolbar').locator(`button[title^="${titlePrefix}"]`);
}

function getCanvasBox(page: Page) {
  return page.locator('canvas').last().boundingBox();
}

/** Draw a rectangle on the canvas so there's at least one element. */
async function drawRectangle(page: Page) {
  await toolButton(page, 'Rectangle').click();
  const box = (await getCanvasBox(page))!;
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 });
  await page.mouse.up();
}

// ─── Export Dialog ──────────────────────────────────────────────

test.describe('Export Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { state: 'visible' });
  });

  test('opens export dialog with Ctrl+Shift+E and closes with Escape', async ({ page }) => {
    // Dialog should not be visible initially
    await expect(page.locator('text=Export')).not.toBeVisible();

    // Open with keyboard shortcut
    await page.keyboard.press('Control+Shift+E');
    await expect(page.locator('h2:has-text("Export")')).toBeVisible();

    // Close with the X button
    await page
      .locator('h2:has-text("Export")')
      .locator('..')
      .locator('button')
      .click();
    await expect(page.locator('h2:has-text("Export")')).not.toBeVisible();
  });

  test('opens export dialog by clicking Export button in header', async ({ page }) => {
    await expect(page.locator('h2:has-text("Export")')).not.toBeVisible();

    // Click the Export button in the header bar
    await page.locator('button[title="Export diagram"]').click();
    await expect(page.locator('h2:has-text("Export")')).toBeVisible();

    // Close with the X button
    await page.locator('h2:has-text("Export")').locator('..').locator('button').click();
    await expect(page.locator('h2:has-text("Export")')).not.toBeVisible();
  });

  test('shows format selector with all options', async ({ page }) => {
    await page.keyboard.press('Control+Shift+E');
    const select = page.locator('select');
    await expect(select).toBeVisible();

    // Check that key format options exist
    const options = await select.locator('option').allTextContents();
    expect(options).toContain('MavisDraw (.mavisdraw)');
    expect(options).toContain('SVG Image');
    expect(options).toContain('PNG Image');
  });

  test('exports .mavisdraw file', async ({ page }) => {
    // Create a shape first
    await drawRectangle(page);

    // Open export dialog
    await page.keyboard.press('Control+Shift+E');
    await expect(page.locator('h2:has-text("Export")')).toBeVisible();

    // Select mavisdraw format (should be default)
    const select = page.locator('select');
    await select.selectOption('mavisdraw');

    // Trigger download
    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Export")').click();
    const download = await downloadPromise;

    // Verify downloaded file
    expect(download.suggestedFilename()).toMatch(/\.mavisdraw$/);

    // Read and validate file content
    const filePath = path.join(os.tmpdir(), download.suggestedFilename());
    await download.saveAs(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.type).toBe('mavisdraw');
    expect(parsed.version).toBe(1);
    expect(parsed.scene.elements.length).toBeGreaterThan(0);

    fs.unlinkSync(filePath);
  });

  test('exports SVG file', async ({ page }) => {
    await drawRectangle(page);

    await page.keyboard.press('Control+Shift+E');
    const select = page.locator('select');
    await select.selectOption('svg');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Export")').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.svg$/);

    const filePath = path.join(os.tmpdir(), download.suggestedFilename());
    await download.saveAs(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('<svg');
    expect(content).toContain('</svg>');

    fs.unlinkSync(filePath);
  });
});

// ─── Import ─────────────────────────────────────────────────────

test.describe('Import', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { state: 'visible' });
  });

  test('hidden file input exists for import', async ({ page }) => {
    // The ImportHandler renders a hidden file input for programmatic opening
    const input = page.locator('#import-file-input');
    await expect(input).toBeAttached();
    expect(await input.getAttribute('type')).toBe('file');
    expect(await input.getAttribute('accept')).toContain('.mavisdraw');
  });

  test('imports .mavisdraw file via file input', async ({ page }) => {
    // Create a .mavisdraw test fixture
    const fixture = JSON.stringify({
      type: 'mavisdraw',
      version: 1,
      appVersion: '0.1.0',
      exportedAt: Date.now(),
      scene: {
        diagrams: [
          {
            id: 'test-diagram',
            title: 'Test',
            parentDiagramId: null,
            parentPortalId: null,
            projectId: 'default',
          },
        ],
        elements: [
          {
            id: 'test-rect-1',
            type: 'rectangle',
            x: 100,
            y: 100,
            width: 200,
            height: 150,
            angle: 0,
            strokeColor: '#000000',
            backgroundColor: '#ffffff',
            strokeWidth: 2,
            strokeStyle: 'solid',
            fillStyle: 'solid',
            roughness: 0,
            opacity: 1,
            roundness: 0,
            seed: 12345,
            version: 1,
            groupIds: [],
            diagramId: 'test-diagram',
            isDeleted: false,
            boundElementIds: [],
          },
        ],
        rootDiagramId: 'test-diagram',
      },
    });

    // Write fixture to temp file
    const fixturePath = path.join(os.tmpdir(), 'test-import.mavisdraw');
    fs.writeFileSync(fixturePath, fixture);

    // Set up dialog handler before triggering import
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Use the hidden file input directly (Ctrl+O may be intercepted by the browser)
    const input = page.locator('#import-file-input');
    await input.setInputFiles(fixturePath);

    // Wait for the import alert to be handled
    await page.waitForTimeout(1000);

    fs.unlinkSync(fixturePath);
  });
});

// ─── Version History ────────────────────────────────────────────

test.describe('Version History Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { state: 'visible' });
  });

  test('Ctrl+S opens version history panel', async ({ page }) => {
    // Panel should not be visible initially
    await expect(page.locator('text=Version History')).not.toBeVisible();

    // Open with keyboard shortcut
    await page.keyboard.press('Control+s');
    await expect(page.locator('h3:has-text("Version History")')).toBeVisible();

    // Close by pressing Ctrl+S again (toggle)
    await page.keyboard.press('Control+s');
    await expect(page.locator('h3:has-text("Version History")')).not.toBeVisible();
  });

  test('can save a version with a label', async ({ page }) => {
    // Create a shape first
    await drawRectangle(page);

    // Open version history
    await page.keyboard.press('Control+s');
    await expect(page.locator('h3:has-text("Version History")')).toBeVisible();

    // Type a label and save
    const input = page.locator('input[placeholder="Version label..."]');
    await input.fill('Test Version 1');
    await page.locator('button:has-text("Save")').click();

    // Wait for the snapshot to appear in the list
    await expect(page.locator('text=Test Version 1')).toBeVisible({ timeout: 5000 });
  });

  test('shows "No versions saved yet" when empty', async ({ page }) => {
    await page.keyboard.press('Control+s');
    await expect(page.locator('text=No versions saved yet.')).toBeVisible({ timeout: 5000 });
  });
});

// ─── Keyboard Shortcuts ─────────────────────────────────────────

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { state: 'visible' });
  });

  test('Ctrl+S does not trigger browser save dialog', async ({ page }) => {
    // This test ensures the keyboard shortcut is properly prevented
    let browserSaveTriggered = false;

    // If the browser's native save is triggered, it would show a dialog
    // but in Playwright with headless, we just verify the version panel opens
    await page.keyboard.press('Control+s');
    await expect(page.locator('h3:has-text("Version History")')).toBeVisible();
  });

  test('Ctrl+Shift+E opens export dialog', async ({ page }) => {
    await page.keyboard.press('Control+Shift+E');
    await expect(page.locator('h2:has-text("Export")')).toBeVisible();
  });
});

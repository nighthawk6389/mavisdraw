import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor, collectErrors } from './helpers/auth';

// ─── Helpers ───────────────────────────────────────────────────

function toolbarButton(page: Page, titlePrefix: string) {
  return page.getByTestId('toolbar').locator(`button[title^="${titlePrefix}"]`);
}

async function drawRectangle(page: Page) {
  await toolbarButton(page, 'Rectangle').click();
  const canvas = page.locator('canvas').last();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 });
  await page.mouse.up();
}

// ─── Console Error Monitoring ──────────────────────────────────
//
// These tests would have caught the React error 185 (Maximum update
// depth exceeded) because they fail on ANY uncaught error or React
// error that appears in the browser console.

test.describe('Runtime Error Detection', () => {
  test('page loads without console errors', async ({ page }) => {
    const errors = collectErrors(page);

    await mockAuthAndOpenEditor(page);
    await page.waitForTimeout(1000);

    expect(errors, 'Expected no console errors on page load').toEqual([]);
  });

  test('no errors after basic canvas interaction', async ({ page }) => {
    const errors = collectErrors(page);

    await mockAuthAndOpenEditor(page);

    await drawRectangle(page);
    await page.waitForTimeout(500);

    expect(errors, 'Expected no console errors after drawing').toEqual([]);
  });

  test('no errors when toggling all panels', async ({ page }) => {
    const errors = collectErrors(page);

    await mockAuthAndOpenEditor(page);

    // Toggle diagram tree
    await toolbarButton(page, 'Diagram tree').click();
    await page.waitForTimeout(300);

    // Toggle style panel
    await toolbarButton(page, 'Style panel').click();
    await page.waitForTimeout(300);

    // Toggle layer panel
    await toolbarButton(page, 'Layer panel').click();
    await page.waitForTimeout(300);

    expect(errors, 'Expected no console errors after toggling panels').toEqual([]);
  });
});

// ─── Diagram Tree Sidebar ──────────────────────────────────────

test.describe('Diagram Tree Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('sidebar is visible by default', async ({ page }) => {
    const sidebar = page.getByTestId('diagram-tree-sidebar');
    await expect(sidebar).toBeVisible();
  });

  test('clicking diagram tree button hides the sidebar', async ({ page }) => {
    const sidebar = page.getByTestId('diagram-tree-sidebar');
    await expect(sidebar).toBeVisible();
    await toolbarButton(page, 'Diagram tree').click();
    await expect(sidebar).not.toBeVisible();
  });

  test('sidebar shows "Diagrams" header', async ({ page }) => {
    const header = page.getByTestId('diagram-tree-sidebar').locator('text=Diagrams');
    await expect(header).toBeVisible();
  });

  test('sidebar shows root diagram node', async ({ page }) => {
    const rootNode = page.getByTestId('tree-node-root-diagram');
    await expect(rootNode).toBeVisible();
    await expect(rootNode).toContainText('Root Diagram');
  });

  test('root diagram node is highlighted as active', async ({ page }) => {
    const rootNode = page.getByTestId('tree-node-root-diagram');
    await expect(rootNode).toHaveClass(/bg-blue-100/);
  });

  test('closing sidebar via X button hides it', async ({ page }) => {
    const sidebar = page.getByTestId('diagram-tree-sidebar');
    await expect(sidebar).toBeVisible();

    const closeBtn = sidebar.locator('button', { hasText: '×' });
    await closeBtn.click();
    await expect(sidebar).not.toBeVisible();
  });

  test('toggling sidebar off and on preserves root node', async ({ page }) => {
    // Sidebar is open by default — verify root node
    await expect(page.getByTestId('tree-node-root-diagram')).toBeVisible();

    // Close
    await toolbarButton(page, 'Diagram tree').click();
    await expect(page.getByTestId('diagram-tree-sidebar')).not.toBeVisible();

    // Re-open
    await toolbarButton(page, 'Diagram tree').click();
    await expect(page.getByTestId('tree-node-root-diagram')).toBeVisible();
  });
});

// ─── Breadcrumb Navigation ─────────────────────────────────────

test.describe('Breadcrumb Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('breadcrumb is visible', async ({ page }) => {
    const breadcrumb = page.getByTestId('breadcrumb');
    await expect(breadcrumb).toBeVisible();
  });

  test('breadcrumb shows root diagram title', async ({ page }) => {
    const breadcrumb = page.getByTestId('breadcrumb');
    await expect(breadcrumb).toContainText('Root Diagram');
  });

  test('breadcrumb at root has no separator', async ({ page }) => {
    const breadcrumb = page.getByTestId('breadcrumb');
    const separators = breadcrumb.locator('text=›');
    await expect(separators).toHaveCount(0);
  });
});

// ─── Portal Creation + Navigation ──────────────────────────────

test.describe('Portal and Drill-down', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('drawing a portal creates a child diagram in the tree', async ({ page }) => {
    // Draw a portal element
    await toolbarButton(page, 'Portal').click();
    const canvas = page.locator('canvas').last();
    const box = (await canvas.boundingBox())!;

    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, box.y + 300, { steps: 5 });
    await page.mouse.up();

    // Sidebar is open by default — verify child diagram appeared
    const sidebar = page.getByTestId('diagram-tree-sidebar');
    await expect(sidebar).toBeVisible();

    // Root should now have a child (the expand arrow indicates children)
    const rootNode = page.getByTestId('tree-node-root-diagram');
    await expect(rootNode).toBeVisible();

    // There should be more than one tree node now (root + child)
    const treeNodes = sidebar.locator('[data-testid^="tree-node-"]');
    await expect(treeNodes).toHaveCount(2);
  });

  test('no errors after drawing a portal', async ({ page }) => {
    const errors = collectErrors(page);

    await toolbarButton(page, 'Portal').click();
    const canvas = page.locator('canvas').last();
    const box = (await canvas.boundingBox())!;

    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, box.y + 300, { steps: 5 });
    await page.mouse.up();

    await page.waitForTimeout(500);
    expect(errors, 'Expected no errors after portal creation').toEqual([]);
  });
});

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

// ─── Helpers ───────────────────────────────────────────────────

function toolbarButton(page: Page, titlePrefix: string) {
  return page.locator('aside').locator(`button[title^="${titlePrefix}"]`);
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
    const errors: string[] = [];

    page.on('pageerror', (err) => {
      errors.push(err.message);
    });

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    // Wait for React to fully mount and settle
    await page.waitForSelector('canvas', { state: 'visible' });
    await page.waitForTimeout(1000);

    expect(errors, 'Expected no console errors on page load').toEqual([]);
  });

  test('no errors after basic canvas interaction', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (err) => {
      errors.push(err.message);
    });

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForSelector('canvas', { state: 'visible' });

    await drawRectangle(page);
    await page.waitForTimeout(500);

    expect(errors, 'Expected no console errors after drawing').toEqual([]);
  });

  test('no errors when toggling all panels', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (err) => {
      errors.push(err.message);
    });

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForSelector('canvas', { state: 'visible' });

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
    await page.goto('/');
    await page.waitForSelector('canvas', { state: 'visible' });
  });

  test('sidebar is hidden by default', async ({ page }) => {
    const sidebar = page.getByTestId('diagram-tree-sidebar');
    await expect(sidebar).not.toBeVisible();
  });

  test('clicking diagram tree button shows the sidebar', async ({ page }) => {
    await toolbarButton(page, 'Diagram tree').click();
    const sidebar = page.getByTestId('diagram-tree-sidebar');
    await expect(sidebar).toBeVisible();
  });

  test('sidebar shows "Diagrams" header', async ({ page }) => {
    await toolbarButton(page, 'Diagram tree').click();
    const header = page.getByTestId('diagram-tree-sidebar').locator('text=Diagrams');
    await expect(header).toBeVisible();
  });

  test('sidebar shows root diagram node', async ({ page }) => {
    await toolbarButton(page, 'Diagram tree').click();
    const rootNode = page.getByTestId('tree-node-root-diagram');
    await expect(rootNode).toBeVisible();
    await expect(rootNode).toContainText('Root Diagram');
  });

  test('root diagram node is highlighted as active', async ({ page }) => {
    await toolbarButton(page, 'Diagram tree').click();
    const rootNode = page.getByTestId('tree-node-root-diagram');
    await expect(rootNode).toHaveClass(/bg-blue-100/);
  });

  test('closing sidebar via X button hides it', async ({ page }) => {
    await toolbarButton(page, 'Diagram tree').click();
    const sidebar = page.getByTestId('diagram-tree-sidebar');
    await expect(sidebar).toBeVisible();

    const closeBtn = sidebar.locator('button', { hasText: '×' });
    await closeBtn.click();
    await expect(sidebar).not.toBeVisible();
  });

  test('toggling sidebar off and on preserves root node', async ({ page }) => {
    // Open
    await toolbarButton(page, 'Diagram tree').click();
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
    await page.goto('/');
    await page.waitForSelector('canvas', { state: 'visible' });
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
    await page.goto('/');
    await page.waitForSelector('canvas', { state: 'visible' });
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

    // Open diagram tree and verify child diagram appeared
    await toolbarButton(page, 'Diagram tree').click();
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
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

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

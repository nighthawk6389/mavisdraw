import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor, collectErrors } from './helpers/auth';

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  label?: string;
  containerId?: string | null;
  targetDiagramId?: string;
  diagramId: string;
};

type Hooks = {
  getActiveElements: () => El[];
  getActiveDiagramId: () => string;
  getSelectedIds: () => string[];
};

const h = {
  els: (page: Page) =>
    page.evaluate(() => (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__.getActiveElements()),
  diagram: (page: Page) =>
    page.evaluate(() => (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__.getActiveDiagramId()),
  selected: (page: Page) =>
    page.evaluate(() => (window as unknown as { __MAVISDRAW__: Hooks }).__MAVISDRAW__.getSelectedIds()),
};

const MERMAID = `flowchart LR
  user((Customer)) -->|HTTPS| web[Web App]
  web --> api
  subgraph backend [Checkout Backend]
    api[API Gateway] -->|gRPC| orders[Orders Service]
    orders --> db[(Orders DB)]
  end`;

/** Paste text onto the canvas the way the browser would on Ctrl/⌘+V. */
async function pasteText(page: Page, text: string) {
  const box = (await page.locator('canvas').last().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate((t) => {
    const data = new DataTransfer();
    data.setData('text/plain', t);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, text);
}

const labels = (els: El[]) =>
  els
    .filter((e) => e.type === 'text')
    .map((e) => e.text)
    .sort();

test.describe('Living architecture map', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('pasting Mermaid builds a layered, nested map', async ({ page }) => {
    const errors = collectErrors(page);
    await pasteText(page, MERMAID);

    await expect(page.getByTestId('toast')).toContainText('1 nested diagram');
    const top = await h.els(page);
    // Top level: Customer, Web App, and a portal into the subgraph
    expect(top.filter((e) => e.type === 'portal').map((e) => e.label)).toEqual(['Checkout Backend']);
    expect(labels(top)).toEqual(['Customer', 'HTTPS', 'Web App']);
    // web --> api crosses into the subgraph: drawn to the portal
    const portal = top.find((e) => e.type === 'portal')!;
    const arrows = top.filter((e) => e.type === 'arrow');
    expect(arrows).toHaveLength(2);

    // Layout is left-to-right: Customer, Web App, portal
    const byLabel = (t: string) => {
      const label = top.find((e) => e.text === t)!;
      return top.find((e) => e.id === label.containerId)!;
    };
    expect(byLabel('Customer').x).toBeLessThan(byLabel('Web App').x);
    expect(byLabel('Web App').x).toBeLessThan(portal.x);

    // Drill into the subgraph
    await page.keyboard.press('Escape');
    const vp = await page.evaluate(
      () => (window as unknown as { __MAVISDRAW__: { getViewport: () => { zoom: number; scrollX: number; scrollY: number } } }).__MAVISDRAW__.getViewport(),
    );
    const box = (await page.locator('canvas').last().boundingBox())!;
    await page.mouse.dblclick(
      box.x + (portal.x + portal.width / 2) * vp.zoom + vp.scrollX,
      box.y + (portal.y + portal.height / 2) * vp.zoom + vp.scrollY,
    );
    await expect.poll(() => h.diagram(page)).toBe(portal.targetDiagramId);
    await expect.poll(async () => labels(await h.els(page))).toEqual([
      'API Gateway',
      'Orders DB',
      'Orders Service',
      'gRPC',
    ]);
    expect(errors).toEqual([]);
  });

  test('a bad Mermaid paste explains what went wrong', async ({ page }) => {
    await pasteText(page, 'graph TD\n  subgraph Unclosed\n  A --> B');
    await expect(page.getByTestId('toast')).toContainText("Couldn't import Mermaid");
    expect(await h.els(page)).toHaveLength(0);
  });

  test('a Mermaid import is one undo step', async ({ page }) => {
    await pasteText(page, MERMAID);
    await expect.poll(async () => (await h.els(page)).length).toBeGreaterThan(5);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await h.els(page)).length).toBe(0);
  });

  test('⌘K jumps to a shape anywhere in the hierarchy', async ({ page }) => {
    await pasteText(page, MERMAID);
    await expect.poll(async () => (await h.els(page)).length).toBeGreaterThan(5);
    const rootId = await h.diagram(page);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await page.keyboard.type('orders db');
    await expect(palette.getByRole('option').first()).toContainText('Orders DB');
    await expect(palette.getByRole('option').first()).toContainText('Checkout Backend');
    await page.keyboard.press('Enter');

    await expect.poll(() => h.diagram(page)).not.toBe(rootId);
    const els = await h.els(page);
    const dbLabel = els.find((e) => e.text === 'Orders DB')!;
    await expect.poll(() => h.selected(page)).toEqual([dbLabel.containerId]);
  });

  test('the command palette runs the Mermaid importer', async ({ page }) => {
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('combobox', { name: /Search shapes/ })).toBeFocused();
    await page.keyboard.type('mermaid');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Import from Mermaid' });
    await dialog.getByRole('button', { name: 'Use an example' }).click();
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await h.els(page)).filter((e) => e.type === 'portal').length).toBe(1);
  });

  test('Tidy up untangles overlapping connected shapes', async ({ page }) => {
    const box = (await page.locator('canvas').last().boundingBox())!;
    const rect = async (x: number, y: number) => {
      await page.keyboard.press('r');
      await page.mouse.move(box.x + x, box.y + y);
      await page.mouse.down();
      await page.mouse.move(box.x + x + 120, box.y + y + 70, { steps: 4 });
      await page.mouse.up();
    };
    // Three overlapping boxes connected in a chain
    await rect(200, 200);
    await rect(240, 220);
    await rect(280, 240);
    const [a, b, c] = await h.els(page);
    const arrow = async (from: El, to: El) => {
      await page.keyboard.press('a');
      await page.mouse.move(box.x + from.x + 10, box.y + from.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + to.x + to.width - 10, box.y + to.y + to.height - 10, { steps: 4 });
      await page.mouse.up();
    };
    await arrow(a, b);
    await arrow(b, c);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+Alt+T');

    await expect
      .poll(async () => {
        const shapes = (await h.els(page)).filter((e) => e.type === 'rectangle');
        // No two shapes overlap after tidying
        for (let i = 0; i < shapes.length; i++) {
          for (let j = i + 1; j < shapes.length; j++) {
            const p = shapes[i];
            const q = shapes[j];
            const overlap =
              p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
            if (overlap) return false;
          }
        }
        return true;
      })
      .toBe(true);
  });

  test('Backspace zooms back out to the parent diagram', async ({ page }) => {
    await pasteText(page, MERMAID);
    await expect.poll(async () => (await h.els(page)).length).toBeGreaterThan(5);
    const rootId = await h.diagram(page);
    const portal = (await h.els(page)).find((e) => e.type === 'portal')!;

    await page.keyboard.press('Escape');
    // Select the portal and press Enter to drill in
    const vp = await page.evaluate(
      () => (window as unknown as { __MAVISDRAW__: { getViewport: () => { zoom: number; scrollX: number; scrollY: number } } }).__MAVISDRAW__.getViewport(),
    );
    const box = (await page.locator('canvas').last().boundingBox())!;
    await page.mouse.click(
      box.x + (portal.x + 6) * vp.zoom + vp.scrollX,
      box.y + (portal.y + 6) * vp.zoom + vp.scrollY,
    );
    await page.keyboard.press('Enter');
    await expect.poll(() => h.diagram(page)).toBe(portal.targetDiagramId);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    await expect.poll(() => h.diagram(page)).toBe(rootId);
  });
});

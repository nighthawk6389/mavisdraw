import { test, expect, type Page } from '@playwright/test';
import {
  API_URL,
  apiCreateProject,
  getActiveElements,
  interactiveCanvas,
  isConnected,
  openProject,
  registerUser,
  screenCenterOf,
  waitForSaved,
} from './helpers';

/**
 * The model in the editor (docs/model-layer.md): copies across levels are the
 * same component, the panel shows where it's drawn and what it depends on,
 * and a rename on the canvas reaches every level.
 */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function pasteMermaid(page: Page, lines: string[]) {
  const box = (await interactiveCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, lines.join('\n'));
}

/** The shape labelled `label` on the open diagram (a box's bound text, or a portal). */
async function shape(page: Page, label: string) {
  const els = await getActiveElements(page);
  const text = els.find((e) => e.type === 'text' && e.text === label && e.containerId);
  const found =
    els.find((e) => e.id === text?.containerId) ??
    els.find((e) => e.type === 'portal' && e.label === label);
  if (!found) throw new Error(`no shape "${label}"`);
  return found;
}

async function click(page: Page, label: string, count = 1) {
  // A selection opens the inspector column, which narrows the canvas (and can
  // hide shapes on the right): start from nothing selected
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('style-panel')).toHaveCount(0);
  const c = await screenCenterOf(page, await shape(page, label));
  if (count === 2) await page.mouse.dblclick(c.x, c.y);
  else await page.mouse.click(c.x, c.y);
}

test.describe('The model in the editor', () => {
  test('a copy on another level is the same component, and renaming it on the canvas renames both', async ({
    page,
    context,
  }) => {
    const user = await registerUser(context, 'Mapper');
    const project = await apiCreateProject(context.request, user, 'Model Editor');
    await openProject(page, 'Model Editor');
    await pasteMermaid(page, [
      'flowchart LR',
      '  web[Web App] --> api',
      '  subgraph platform [Platform]',
      '    api[API] --> db[(Orders DB)]',
      '  end',
    ]);
    await waitForSaved(page);
    await isConnected(page);

    // The panel says what the selected shape is
    await click(page, 'Platform');
    const panel = page.getByTestId('component-panel');
    await expect(panel.getByLabel('Component name')).toHaveValue('Platform');
    await expect(panel.getByLabel('Kind')).toHaveValue('system');
    await expect(panel).toContainText('Opens into its own diagram');
    // Platform depends on what's inside it depends on (here: nothing outside)
    await expect(panel.getByTestId('component-dependents')).toContainText('Web App');

    // Copy Web App into Platform: the same component, now on two levels
    await click(page, 'Web App');
    await page.keyboard.press(`${mod}+c`);
    await click(page, 'Platform', 2);
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect.poll(async () => (await shape(page, 'API').catch(() => null)) !== null).toBe(true);
    const box = (await interactiveCanvas(page).boundingBox())!;
    await page.mouse.move(box.x + 120, box.y + 120);
    await page.keyboard.press(`${mod}+v`);
    await expect
      .poll(async () => (await shape(page, 'Web App').catch(() => null)) !== null)
      .toBe(true);
    await waitForSaved(page);
    await click(page, 'Web App');
    await expect(panel).toContainText('Appears in 2 diagrams', { timeout: 10_000 });

    // Rename it here, on the canvas…
    await click(page, 'Web App', 2);
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.type('Storefront', { delay: 0 });
    await page.keyboard.press('Enter');
    await waitForSaved(page);

    // …and the top level says Storefront too
    await page.getByTestId('breadcrumb').getByRole('button').first().click();
    await expect
      .poll(async () => (await shape(page, 'Storefront').catch(() => null)) !== null, {
        timeout: 15_000,
      })
      .toBe(true);
    const res = await context.request.get(`${API_URL}/api/projects/${project.id}/model`, {
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    const { model } = (await res.json()) as {
      model: { components: Array<{ name: string; appearances: unknown[] }> };
    };
    expect(model.components.find((c) => c.name === 'Storefront')?.appearances).toHaveLength(2);
    expect(model.components.some((c) => c.name === 'Web App')).toBe(false);
  });

  test('details are recorded, and a same-named shape elsewhere can be linked', async ({
    page,
    context,
  }) => {
    const user = await registerUser(context, 'Linker');
    const project = await apiCreateProject(context.request, user, 'Model Links');
    await openProject(page, 'Model Links');
    await pasteMermaid(page, [
      'flowchart LR',
      '  api[API] --> cache[Redis]',
      '  subgraph jobs [Jobs]',
      '    worker[Worker] --> redis2[Redis]',
      '  end',
    ]);
    await waitForSaved(page);
    await isConnected(page);

    // Details
    await click(page, 'API');
    const panel = page.getByTestId('component-panel');
    await panel.getByLabel('Description').fill('Public REST API');
    await panel.getByLabel('Technology').fill('Node.js');
    await panel.getByLabel('Technology').blur();
    await panel.getByLabel('Link name').fill('Runbook');
    await panel.getByLabel('Link address').fill('https://wiki.example.com/api');
    await panel.getByRole('button', { name: 'Add' }).click();
    await expect(panel.getByRole('link', { name: 'Runbook' })).toHaveAttribute(
      'href',
      'https://wiki.example.com/api',
    );
    // They're the model's, not this tab's: a reload shows them
    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible();
    await click(page, 'API');
    await expect(panel.getByLabel('Description')).toHaveValue('Public REST API');
    await expect(panel.getByLabel('Technology')).toHaveValue('Node.js');

    // The two Redis boxes are separate components: offered for linking
    await click(page, 'Redis');
    await expect(panel.getByTestId('possible-duplicate')).toContainText('Also drawn separately');
    await panel.getByRole('button', { name: 'Same thing? Link' }).click();
    await expect(panel).toContainText('Appears in 2 diagrams', { timeout: 10_000 });
    await expect(panel.getByTestId('possible-duplicate')).toHaveCount(0);
    // …and API's dependencies now include what Worker uses, as one Redis
    const res = await context.request.get(`${API_URL}/api/projects/${project.id}/model`, {
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    const { model } = (await res.json()) as { model: { components: Array<{ name: string }> } };
    expect(model.components.filter((c) => c.name === 'Redis')).toHaveLength(1);

    // The model exports as a C4 workspace (Structurizr DSL): Jobs is a
    // system with Worker inside, and the one Redis is shared
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Export' }).click();
    await page.locator('select').first().selectOption('structurizr');
    const downloadPromise = page.waitForEvent('download');
    await page
      .getByRole('button', { name: /^Export$/ })
      .last()
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.dsl$/);
    const fs = await import('node:fs');
    const dsl = fs.readFileSync((await download.path())!, 'utf8');
    expect(dsl).toMatch(/^workspace "/);
    expect(dsl).toContain('jobs = softwareSystem "Jobs"');
    expect(dsl).toContain('worker = container "Worker"');
    expect(dsl.match(/= \w+ "Redis"/g)).toHaveLength(1);
    expect(dsl).toContain('jobs.worker -> redis');
    expect(dsl).toContain('api = softwareSystem "API" "Public REST API"');
  });
});

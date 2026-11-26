import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  API_URL,
  registerUser,
  apiCreateProject,
  apiGetDiagram,
  openProject,
  dragOnCanvas,
  getActiveElements,
  interactiveCanvas,
  screenCenterOf,
  type TestUser,
} from './helpers';

async function shareLink(
  ctx: BrowserContext,
  owner: TestUser,
  projectId: string,
  role: 'viewer' | 'editor',
) {
  const res = await ctx.request.post(`${API_URL}/api/projects/${projectId}/share`, {
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    data: { role },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { share: { shareToken: string } }).share.shareToken;
}

async function isConnected(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (
            window as unknown as { __MAVISDRAW__?: { getConnectionStatus: () => string } }
          ).__MAVISDRAW__?.getConnectionStatus(),
        ),
      { timeout: 15_000 },
    )
    .toBe('connected');
}

const types = async (page: Page) => (await getActiveElements(page)).map((e) => e.type).sort();

/** Owner + a second user who joined through a share link, both in the editor. */
async function twoPeople(browser: Browser, role: 'viewer' | 'editor') {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const owner = await registerUser(ctxA, 'Owner');
  const guest = await registerUser(ctxB, role === 'viewer' ? 'Viewer' : 'Editor');
  const project = await apiCreateProject(ctxA.request, owner, `Team ${role}`);
  const token = await shareLink(ctxA, owner, project.id, role);

  await openProject(a, `Team ${role}`);
  // The guest follows the share link like a real person would
  await b.goto(`/share/${token}`);
  await expect(b.locator('canvas').first()).toBeVisible();
  await isConnected(a);
  await isConnected(b);
  return { ctxA, ctxB, a, b, owner, guest, project };
}

test.describe('Teams', () => {
  test('a share link opens the project, and the URL deep-links the diagram', async ({
    browser,
  }) => {
    const { ctxA, ctxB, b, project } = await twoPeople(browser, 'editor');
    await expect(b).toHaveURL(new RegExp(`/p/${project.id}$`));
    await expect(b.getByTestId('view-only-badge')).toHaveCount(0);

    // Draw a portal, drill in: the address bar follows and survives a reload
    await b.keyboard.press('o');
    await dragOnCanvas(b, { x: 200, y: 160 }, { x: 420, y: 300 });
    const [portal] = await getActiveElements(b);
    const center = await screenCenterOf(b, portal);
    await b.mouse.dblclick(center.x, center.y);
    await expect(b).toHaveURL(new RegExp(`/p/${project.id}/d/${portal.targetDiagramId}$`));
    await b.reload();
    await expect
      .poll(() =>
        b.evaluate(() =>
          (
            window as unknown as { __MAVISDRAW__?: { getActiveDiagramId: () => string } }
          ).__MAVISDRAW__?.getActiveDiagramId(),
        ),
      )
      .toBe(portal.targetDiagramId);

    await ctxA.close();
    await ctxB.close();
  });

  test('undo only undoes your own work, and nothing is lost on the server', async ({ browser }) => {
    const { ctxA, ctxB, a, b, owner, project } = await twoPeople(browser, 'editor');

    await a.keyboard.press('r');
    await dragOnCanvas(a, { x: 150, y: 150 }, { x: 300, y: 250 });
    await b.keyboard.press('e');
    await dragOnCanvas(b, { x: 400, y: 150 }, { x: 520, y: 250 });
    await expect.poll(() => types(a)).toEqual(['ellipse', 'rectangle']);
    await expect.poll(() => types(b)).toEqual(['ellipse', 'rectangle']);

    // Alice undoes: her rectangle goes, Bob's ellipse stays — for both of them
    await a.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect.poll(() => types(a)).toEqual(['ellipse']);
    await expect.poll(() => types(b)).toEqual(['ellipse']);

    // Both people's work reaches the database (no last-writer-wins clobbering)
    await b.keyboard.press('d');
    await dragOnCanvas(b, { x: 150, y: 350 }, { x: 260, y: 450 });
    await expect
      .poll(
        async () =>
          (
            (await apiGetDiagram(ctxA.request, owner, project.rootDiagramId)).diagram?.elements ??
            []
          )
            .map((e) => e.type as string)
            .sort(),
        { timeout: 20_000 },
      )
      .toEqual(['diamond', 'ellipse']);

    await ctxA.close();
    await ctxB.close();
  });

  test('viewers watch live but cannot change anything', async ({ browser }) => {
    const { ctxA, ctxB, a, b } = await twoPeople(browser, 'viewer');

    await expect(b.getByTestId('view-only-badge')).toBeVisible();
    // Only navigation tools
    const toolbar = b.getByTestId('toolbar');
    await expect(toolbar.locator('button[title^="Select"]')).toBeVisible();
    await expect(toolbar.locator('button[title^="Hand"]')).toBeVisible();
    for (const tool of ['Rectangle', 'Ellipse', 'Arrow', 'Text', 'Portal']) {
      await expect(toolbar.locator(`button[title^="${tool}"]`)).toHaveCount(0);
    }
    await expect(b.getByRole('button', { name: 'Share' })).toHaveCount(0);

    // The owner draws; the viewer sees it live
    await a.keyboard.press('r');
    await dragOnCanvas(a, { x: 150, y: 150 }, { x: 300, y: 250 });
    await expect.poll(() => types(b)).toEqual(['rectangle']);

    // The viewer tries to draw, drag and delete: nothing changes anywhere
    await b.keyboard.press('r');
    await dragOnCanvas(b, { x: 400, y: 300 }, { x: 500, y: 380 });
    const [rect] = await getActiveElements(b);
    const c = await screenCenterOf(b, rect);
    const box = (await interactiveCanvas(b).boundingBox())!;
    await b.mouse.move(c.x, c.y);
    await b.mouse.down();
    await b.mouse.move(c.x + 120, c.y + 80, { steps: 5 });
    await b.mouse.up();
    await b.keyboard.press('Delete');
    expect(box).toBeTruthy();
    await b.waitForTimeout(500);
    expect(await types(b)).toEqual(['rectangle']);
    expect(await types(a)).toEqual(['rectangle']);
    expect((await getActiveElements(a))[0].x).toBe(rect.x);

    await ctxA.close();
    await ctxB.close();
  });

  test('version history is shared and restoring updates everyone live', async ({ browser }) => {
    const { ctxA, ctxB, a, b } = await twoPeople(browser, 'editor');

    await a.keyboard.press('r');
    await dragOnCanvas(a, { x: 150, y: 150 }, { x: 300, y: 250 });
    await expect.poll(() => types(b)).toEqual(['rectangle']);

    // Alice saves a named version
    await a.getByRole('button', { name: 'History' }).click();
    await a.getByPlaceholder('Version label...').fill('Before the redesign');
    await a.getByPlaceholder('Version label...').press('Enter');
    await expect(a.getByTestId('version-history').getByText('Before the redesign')).toBeVisible();

    // Bob sees it in his history
    await b.getByRole('button', { name: 'History' }).click();
    await expect(b.getByTestId('version-history').getByText('Before the redesign')).toBeVisible();

    // Alice keeps editing (focus is still in the label field, so she picks
    // the tool from the toolbar); Bob restores the version; Alice's canvas follows
    await a.getByTestId('toolbar').locator('button[title^="Ellipse"]').click();
    await dragOnCanvas(a, { x: 400, y: 150 }, { x: 520, y: 250 });
    await expect.poll(() => types(b)).toEqual(['ellipse', 'rectangle']);
    b.once('dialog', (d) => d.accept());
    const entry = b
      .getByTestId('version-history')
      .getByTestId('version-entry')
      .filter({ hasText: 'Before the redesign' });
    await entry.hover();
    await entry.getByRole('button', { name: 'Restore' }).click();
    await expect.poll(() => types(a)).toEqual(['rectangle']);
    await expect.poll(() => types(b)).toEqual(['rectangle']);

    await ctxA.close();
    await ctxB.close();
  });
});

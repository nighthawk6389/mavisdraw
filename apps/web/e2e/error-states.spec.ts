import { test, expect, type Page } from '@playwright/test';
import { mockAuthAndOpenEditor, mockSignedIn, TEST_PROJECT } from './helpers/auth';

/**
 * What people see when the server says no or isn't there: every failure
 * should explain itself and leave them somewhere useful, never a blank
 * screen or a silent loss of work.
 */

const toast = (page: Page, text: string | RegExp) =>
  page.getByTestId('toast').filter({ hasText: text });

/** Paste a Mermaid flowchart onto the canvas: an ordinary, undoable edit. */
async function pasteFlowchart(page: Page, lines: string[]) {
  const box = (await page.locator('canvas').last().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, lines.join('\n'));
}

/** Make one edit without the pointer (the dev-only test hook adds a shape). */
async function addShape(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { __MAVISDRAW__: { seedRectangles: (n: number) => void } }
    ).__MAVISDRAW__.seedRectangles(1),
  );
}

test.describe('Error states', () => {
  test('the dashboard says why projects did not load', async ({ page }) => {
    await mockSignedIn(page);
    await page.route('**/api/projects', (route) =>
      route.fulfill({ status: 503, json: { error: 'The database is unavailable' } }),
    );
    await page.goto('/');
    await expect(page.getByText('The database is unavailable')).toBeVisible();
    await expect(page.getByTestId('project-card')).toHaveCount(0);
  });

  test('a refused delete keeps the project and says why', async ({ page }) => {
    await mockSignedIn(page);
    await page.route(`**/api/projects/${TEST_PROJECT.id}`, (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({ status: 403, json: { error: 'Only the owner can delete this project' } })
        : route.fallback(),
    );
    await page.goto('/');
    const card = page.getByTestId('project-card').filter({ hasText: TEST_PROJECT.name });
    await card.hover();
    page.once('dialog', (d) => void d.accept());
    await card.getByRole('button', { name: /delete/i }).click();
    await expect(page.getByText('Only the owner can delete this project')).toBeVisible();
    await expect(card).toBeVisible();
  });

  for (const [status, error] of [
    [403, 'Access denied'],
    [404, 'Project not found'],
  ] as const) {
    test(`a project link that answers ${status} goes back to the dashboard and says so`, async ({
      page,
    }) => {
      await mockSignedIn(page);
      await page.route(`**/api/projects/${TEST_PROJECT.id}`, (route) =>
        route.fulfill({ status, json: { error } }),
      );
      await page.goto(`/p/${TEST_PROJECT.id}`);
      await expect(toast(page, "Couldn't open that project")).toBeVisible();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { name: /projects/i }).first()).toBeVisible();
    });
  }

  test('a share link that no longer works says why', async ({ page }) => {
    await mockSignedIn(page);
    await page.route('**/api/share/revoked-token', (route) =>
      route.fulfill({ status: 404, json: { error: 'Invalid share link' } }),
    );
    await page.goto('/share/revoked-token');
    await expect(toast(page, "This share link doesn't work: Invalid share link")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('a failed save is shown, the edit is kept, and it saves once the server is back', async ({
    page,
  }) => {
    await mockAuthAndOpenEditor(page);
    let failing = true;
    const saves: Array<{ elements: Array<{ type: string }> }> = [];
    await page.route('**/api/diagrams/root-diagram', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      if (failing) return route.fulfill({ status: 500, json: { error: 'Internal server error' } });
      const body = route.request().postDataJSON() as { elements: Array<{ type: string }> };
      saves.push(body);
      return route.fulfill({
        status: 200,
        json: { diagram: { ...body, id: 'root-diagram' }, conflicts: [] },
      });
    });

    await pasteFlowchart(page, ['flowchart LR', '  web[Web] --> api[API]']);
    // Not "Saved": the edits are said to be kept on this device, unsaved
    await expect(page.getByTestId('offline-indicator')).toHaveText(
      /^Not saved yet · \d+ changes kept on this device$/,
      { timeout: 10_000 },
    );
    await expect(page.getByText('Saved', { exact: true })).toHaveCount(0);

    // The server recovers; the next edit saves everything, nothing is lost
    failing = false;
    await pasteFlowchart(page, ['flowchart LR', '  db[(Orders DB)]']);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('offline-indicator')).toHaveCount(0);
    const types = saves.at(-1)!.elements.map((e) => e.type);
    // Web, API and Orders DB, and the arrow between the first two
    expect(types.filter((t) => t === 'arrow')).toHaveLength(1);
    expect(types.length).toBeGreaterThanOrEqual(4);
  });

  test('when the session can no longer be renewed, it asks to sign in again', async ({ page }) => {
    await mockAuthAndOpenEditor(page);
    // The access token is rejected and the refresh cookie is gone
    await page.route('**/api/auth/refresh', (route) =>
      route.fulfill({ status: 401, json: { error: 'Invalid refresh token' } }),
    );
    await page.route('**/api/diagrams/root-diagram', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 401, json: { error: 'Invalid or expired access token' } })
        : route.fallback(),
    );
    await addShape(page);
    await expect(page.getByRole('heading', { name: 'Sign in to MavisDraw' })).toBeVisible({
      timeout: 10_000,
    });
  });
});

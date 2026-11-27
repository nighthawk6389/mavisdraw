import { test, expect } from '@playwright/test';
import { mockAuthAndOpenEditor, TEST_PROJECT } from './helpers/auth';

test.describe('Collaboration UI', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndOpenEditor(page);
  });

  test('the editor opens for a signed-in user, not live without a collaboration server', async ({
    page,
  }) => {
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(page.getByText('Root Diagram').first()).toBeVisible();
    // No presence indicator: nobody is connected live
    await expect(page.locator('[title="Connected"]')).toHaveCount(0);
  });

  test('the Share dialog creates a link to copy and lists it until revoked', async ({ page }) => {
    const permissions: Array<Record<string, unknown>> = [];
    let created: unknown = null;
    await page.route(`**/api/projects/${TEST_PROJECT.id}/permissions`, (route) =>
      route.fulfill({ status: 200, json: { permissions } }),
    );
    await page.route(`**/api/projects/${TEST_PROJECT.id}/invites`, (route) =>
      route.fulfill({ status: 200, json: { invites: [] } }),
    );
    await page.route(`**/api/projects/${TEST_PROJECT.id}/share`, (route) => {
      created = route.request().postDataJSON();
      const share = { id: 'perm-1', shareToken: 'tok-0123456789abcdef', role: 'editor' };
      permissions.push({ ...share, userId: null, email: null, name: null, createdAt: '' });
      return route.fulfill({
        status: 201,
        json: { share: { ...share, projectId: TEST_PROJECT.id } },
      });
    });
    await page.route('**/api/permissions/perm-1', (route) => {
      permissions.splice(0);
      return route.fulfill({ status: 200, json: { message: 'Permission revoked' } });
    });

    await page.getByRole('button', { name: 'Share' }).click();
    await expect(page.getByRole('heading', { name: 'Share Project' })).toBeVisible();
    await page
      // The share-link role (the other select is the email invite's role)
      .locator('select:not([aria-label="Invite role"])', {
        has: page.locator('option', { hasText: 'Can edit' }),
      })
      .selectOption('editor');
    await page.getByRole('button', { name: 'Create Link' }).click();

    const origin = new URL(page.url()).origin;
    await expect(page.locator('input[readonly]')).toHaveValue(
      `${origin}/share/tok-0123456789abcdef`,
    );
    expect(created).toEqual({ role: 'editor' });
    await expect(page.getByText('Link (editor)')).toBeVisible();
    await expect(page.getByText('...89abcdef')).toBeVisible();

    await page.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('Link (editor)')).toHaveCount(0);
  });
});

test.describe('Collaboration Components Structure', () => {
  test('CursorOverlay renders nothing when no remote cursors', async ({ page }) => {
    await mockAuthAndOpenEditor(page);

    // The CursorOverlay renders an absolute div with these classes only when
    // there are remote cursors. Use a more specific selector to avoid matching
    // toolbar tooltips that share pointer-events-none + z-50.
    const cursorOverlay = page.locator('canvas.pointer-events-none.z-50');
    const count = await cursorOverlay.count();
    // Should be 0 since no collaboration is active
    expect(count).toBe(0);
  });

  test('PresenceAvatars not visible when not connected', async ({ page }) => {
    await mockAuthAndOpenEditor(page);

    // The presence dot indicator should not be visible
    const greenDot = page.locator('[title="Connected"]');
    const count = await greenDot.count();
    expect(count).toBe(0);
  });
});

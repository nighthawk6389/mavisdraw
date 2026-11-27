import { test, expect } from '@playwright/test';
import {
  registerUser,
  openProject,
  dragOnCanvas,
  getActiveElements,
  waitForSaved,
} from './helpers';

test.describe('Persistence against the real backend', () => {
  test('a new user can create a project, draw, and see the drawing after reload', async ({
    page,
    context,
  }) => {
    await registerUser(context, 'Persistence Tester');

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

    // Create a project through the dashboard UI
    await page.getByRole('button', { name: 'New Project' }).click();
    await page.getByPlaceholder('Project name').fill('Payments Platform');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText('Payments Platform', { exact: true })).toBeVisible();

    await openProject(page, 'Payments Platform');

    // Draw a rectangle
    await page.keyboard.press('r');
    await dragOnCanvas(page, { x: 200, y: 200 }, { x: 360, y: 300 });
    await expect.poll(async () => (await getActiveElements(page)).length).toBe(1);
    await waitForSaved(page);

    // Reload: the rectangle must come back from the server
    await page.reload();
    await openProject(page, 'Payments Platform');
    await expect
      .poll(async () => (await getActiveElements(page)).map((e) => e.type))
      .toEqual(['rectangle']);
  });
});

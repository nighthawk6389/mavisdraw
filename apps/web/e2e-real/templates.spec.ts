import { test, expect, type Page } from '@playwright/test';
import {
  API_URL,
  apiCreateProject,
  getActiveElements,
  openProject,
  registerUser,
  screenCenterOf,
  waitForSaved,
  type TestUser,
} from './helpers';

type El = Awaited<ReturnType<typeof getActiveElements>>[number];

/** What people read on the diagram on screen: portal labels and shape labels. */
const labels = (els: El[]) =>
  els
    .flatMap((e) =>
      e.type === 'portal'
        ? [`⧉ ${e.label as string}`]
        : e.type === 'text' &&
            e.containerId &&
            els.find((c) => c.id === e.containerId)?.type !== 'arrow'
          ? [e.text as string]
          : [],
    )
    .sort();

async function projectsOf(page: Page, user: TestUser) {
  const res = await page.request.get(`${API_URL}/api/projects`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
  });
  return ((await res.json()) as { projects: Array<{ id: string; name: string }> }).projects;
}

test.describe('Templates and first run', () => {
  test('a new person explores the sample: a three-level map, there once', async ({
    page,
    context,
  }) => {
    const user = await registerUser(context, 'Newcomer');
    await page.goto('/');
    const welcome = page.getByTestId('welcome');
    await expect(welcome).toContainText('Map your system in minutes');

    await welcome.getByRole('button', { name: /Explore a sample/ }).click();
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(page.getByTestId('toast').filter({ hasText: 'Started from' })).toContainText(
      'C4: context → containers → components',
    );
    await expect
      .poll(async () => labels(await getActiveElements(page)))
      .toEqual([
        'Back-office staff',
        'Customer',
        'Email service',
        'Payment provider',
        '⧉ Online Shop',
      ]);
    // The address no longer asks for the template, so a reload can't add it twice
    expect(new URL(page.url()).search).toBe('');

    // Look inside the shop
    const shop = (await getActiveElements(page)).find((e) => e.label === 'Online Shop')!;
    const c = await screenCenterOf(page, shop);
    await page.mouse.dblclick(c.x, c.y);
    await expect
      .poll(async () => labels(await getActiveElements(page)))
      .toEqual(['Database', 'Message queue', 'Mobile App', 'Web App', 'Worker', '⧉ API']);
    await waitForSaved(page);

    // Back at the top after a reload: the same map, not a second copy
    const [project] = await projectsOf(page, user);
    expect(project.name).toBe('Sample: Online shop');
    await page.goto(`/p/${project.id}`);
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect
      .poll(async () => labels(await getActiveElements(page)))
      .toEqual([
        'Back-office staff',
        'Customer',
        'Email service',
        'Payment provider',
        '⧉ Online Shop',
      ]);
  });

  test('a new project can start from any template', async ({ page, context }) => {
    await registerUser(context, 'Template Picker');
    await page.goto('/');
    await page.getByRole('button', { name: 'New Project' }).click();
    const picker = page.getByRole('radiogroup', { name: 'Start from' });
    await expect(picker.getByRole('radio', { name: /Blank/ })).toBeChecked();
    await picker.getByText('Microservices', { exact: true }).click();
    // The name follows the template until someone types their own
    await expect(page.getByPlaceholder('Project name')).toHaveValue('Microservices');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.locator('canvas').first()).toBeVisible();

    await expect
      .poll(async () => labels(await getActiveElements(page)))
      .toEqual(
        expect.arrayContaining([
          'API Gateway',
          '⧉ Orders service',
          '⧉ Catalog service',
          '⧉ Payments service',
          'Event bus',
        ]),
      );
    await waitForSaved(page);
  });

  test('an empty map offers a template, and the offer goes away once used', async ({
    page,
    context,
  }) => {
    const user = await registerUser(context, 'Blank Slate');
    await apiCreateProject(context.request, user, 'Empty Map');
    await openProject(page, 'Empty Map');
    const hint = page.getByTestId('empty-canvas-hint');
    await expect(hint).toBeVisible();

    // Picking a drawing tool gets it out of the way
    await page.keyboard.press('r');
    await expect(hint).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(hint).toBeVisible();

    await hint.getByRole('button', { name: 'Use a template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Insert a template' });
    await dialog.getByText('SaaS platform', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Insert' }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => labels(await getActiveElements(page)))
      .toEqual(expect.arrayContaining(['Auth0', 'Stripe', '⧉ Platform']));
    await expect(hint).toHaveCount(0);

    // The new map is one undo step away from empty again
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await getActiveElements(page)).length).toBe(0);
  });

  test('"Map a repository" from the welcome opens straight into the repository dialog', async ({
    page,
    context,
  }) => {
    await registerUser(context, 'Repo Mapper');
    await page.goto('/');
    await page
      .getByTestId('welcome')
      .getByRole('button', { name: /Map a repository/ })
      .click();
    await expect(page.getByTestId('repo-dialog')).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();
  });
});

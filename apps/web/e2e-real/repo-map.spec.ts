import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API_URL,
  apiCreateProject,
  getActiveElements,
  openProject,
  registerUser,
  screenCenterOf,
} from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(here, 'fixtures', name);

type El = Awaited<ReturnType<typeof getActiveElements>>[number];
const labels = (els: El[]) => {
  const text = new Map(
    els.filter((e) => e.type === 'text').map((e) => [e.containerId as string, e.text as string]),
  );
  return els
    .filter((e) => e.type !== 'text' && e.type !== 'arrow')
    .map((e) => (e.type === 'portal' ? `⧉ ${e.label}` : text.get(e.id)))
    .sort();
};

async function openCodeDialog(page: Page) {
  await page.getByRole('button', { name: /^Code/ }).click();
  await expect(page.getByTestId('repo-dialog')).toBeVisible();
}

test('a repository becomes a nested map, and the map is kept in line with the code', async ({
  page,
  context,
}) => {
  const user = await registerUser(context, 'Architect');
  const project = await apiCreateProject(context.request, user, 'Shop Architecture');
  await openProject(page, 'Shop Architecture');

  // ── Generate from a folder ────────────────────────────────────────
  await openCodeDialog(page);
  await page.getByTestId('repo-folder-input').setInputFiles(fixture('shop-v1'));
  await expect(page.getByTestId('toast').filter({ hasText: 'Mapped shop-v1' })).toContainText(
    '5 components, 3 services and datastores',
  );

  const top = await getActiveElements(page);
  expect(labels(top)).toEqual([
    'PostgreSQL',
    'Redis',
    'Stripe',
    '⧉ api',
    '⧉ api-client',
    '⧉ core',
    '⧉ storefront',
    '⧉ ui',
  ]);
  const api = top.find((e) => e.type === 'portal' && e.label === 'api')!;
  expect(api.codePath).toBe('apps/api');
  const arrowLabels = top
    .filter((e) => e.type === 'text' && top.find((a) => a.id === e.containerId)?.type === 'arrow')
    .map((e) => e.text);
  expect(arrowLabels).toEqual(expect.arrayContaining(['reads/writes', 'calls', 'uses']));

  // Each component is a level of its own: drill into the API
  const c = await screenCenterOf(page, api);
  await page.mouse.dblclick(c.x, c.y);
  await expect
    .poll(async () => labels(await getActiveElements(page)))
    .toEqual(['db (1 file)', 'routes (2 files)', 'services (1 file)']);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');

  // The link to the code is saved with the project
  const saved = await context.request.get(`${API_URL}/api/projects/${project.id}`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
  });
  const { project: p } = (await saved.json()) as {
    project: { repoSource: { label: string; model: { components: unknown[] } } };
  };
  expect(p.repoSource.label).toBe('shop-v1');
  expect(p.repoSource.model.components).toHaveLength(5);

  // ── Later: the code moved on ──────────────────────────────────────
  await openCodeDialog(page);
  await expect(page.getByTestId('repo-linked')).toContainText('Mapped from shop-v1');
  await page.getByTestId('repo-folder-input').setInputFiles(fixture('shop-v2'));
  const items = page.getByTestId('drift-item');
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toContainText('New package in the code: billing (packages/billing)');
  await expect(items.nth(1)).toContainText('api-client is gone from the code');
  await expect(items.nth(2)).toContainText('api now depends on billing');
  await expect(items.nth(3)).toContainText('api now uses Anthropic API');
  await expect(page.getByRole('button', { name: /^Code · 4 changes/ })).toBeVisible();

  // Fix each one from the list
  await items.nth(0).getByRole('button', { name: 'Add to map' }).click();
  await expect(items.nth(0)).toContainText('Done ✓');
  await items.nth(1).getByRole('button', { name: 'Remove from map' }).click();
  await expect(items.nth(1)).toContainText('Done ✓');
  await items.nth(2).getByRole('button', { name: 'Connect' }).click();
  await expect(items.nth(2)).toContainText('Done ✓');
  await items.nth(3).getByRole('button', { name: 'Connect' }).click();
  await expect(items.nth(3)).toContainText('Done ✓');

  const now = await getActiveElements(page);
  expect(labels(now)).toEqual([
    'Anthropic API',
    'PostgreSQL',
    'Redis',
    'Stripe',
    '⧉ api',
    '⧉ billing',
    '⧉ core',
    '⧉ storefront',
    '⧉ ui',
  ]);
  const billing = now.find((e) => e.type === 'portal' && e.label === 'billing')!;
  expect(billing.codePath).toBe('packages/billing');
  const apiNow = now.find((e) => e.type === 'portal' && e.label === 'api')!;
  const binds = (e: El, key: 'startBinding' | 'endBinding') =>
    (e[key] as { elementId?: string } | null)?.elementId;
  expect(
    now.some(
      (e) =>
        e.type === 'arrow' &&
        binds(e, 'startBinding') === apiNow.id &&
        binds(e, 'endBinding') === billing.id,
    ),
  ).toBe(true);

  // Accept: the map is the new baseline, nothing left to fix
  await page.getByRole('button', { name: 'Mark map as up to date' }).click();
  await expect(
    page.getByTestId('toast').filter({ hasText: 'up to date with the code' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Code', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await openCodeDialog(page);
  await page.getByTestId('repo-folder-input').setInputFiles(fixture('shop-v2'));
  await expect(
    page.getByTestId('toast').filter({ hasText: 'The map matches the code' }),
  ).toBeVisible();
});

import { test, expect } from '@playwright/test';
import {
  registerUser,
  apiCreateProject,
  apiGetDiagram,
  openProject,
  getActiveElements,
  waitForSaved,
} from './helpers';

test('AI chat proposes a change that applies as a laid-out, persistent diagram', async ({
  page,
  context,
}) => {
  const user = await registerUser(context, 'AI User');
  const project = await apiCreateProject(context.request, user, 'AI Project');
  await openProject(page, 'AI Project');

  await page.getByRole('button', { name: 'AI Chat' }).click();
  await page.getByPlaceholder('Ask about your diagram...').fill('Add a cache in front of the API');
  await page.getByRole('button', { name: 'Send' }).click();

  // The proposal streams back through the real HTTP pipeline (CORS, streaming, tool call)
  await expect(page.getByText('Add a cache in front of the API').last()).toBeVisible();
  await expect(page.getByText(/proposed a cache/)).toBeVisible();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('toast')).toContainText('3 added, 2 connected');

  const els = await getActiveElements(page);
  const labels = els
    .filter((e) => e.type === 'text')
    .map((e) => e.text)
    .sort();
  expect(labels).toEqual(['API', 'Orders DB', 'Redis Cache', 'on miss', 'reads']);
  const shapes = els.filter((e) => e.type === 'rectangle');
  // Laid out left-to-right without overlaps
  const xs = shapes.map((s) => s.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(100);

  await waitForSaved(page);
  const saved = await apiGetDiagram(context.request, user, project.rootDiagramId);
  expect((saved.diagram?.elements ?? []).filter((e) => e.type === 'arrow')).toHaveLength(2);
});

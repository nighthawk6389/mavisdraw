import { test, expect } from '@playwright/test';
import {
  API_URL,
  GITHUB_URL,
  connectGitHub,
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

test('the assistant reads code only from the project’s linked repositories', async ({
  page,
  context,
}) => {
  const user = await registerUser(context, 'Code Reader');
  const project = await apiCreateProject(context.request, user, 'Linked Project');
  // Two repositories this person's GitHub account can read; the map is linked to one
  const id = Date.now().toString(36);
  const linked = `acme/payments-${id}`;
  const other = `acme/private-${id}`;
  for (const [repo, text] of [
    [linked, 'Payments talks to Stripe.'],
    [other, 'TOP SECRET plans'],
  ]) {
    const setUp = await context.request.post(`${GITHUB_URL}/__test/repo`, {
      data: { repo, trees: { HEAD: ['README.md'] }, contents: { HEAD: { 'README.md': text } } },
    });
    expect(setUp.status()).toBe(200);
  }
  const connectionId = await connectGitHub(context.request, user);
  const link = await context.request.put(`${API_URL}/api/projects/${project.id}/repo`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
    data: {
      kind: 'github',
      label: linked,
      owner: linked.split('/')[0],
      repo: linked.split('/')[1],
      connectionId,
      model: { name: 'Payments', components: [], resources: [] },
    },
  });
  expect(link.status(), await link.text()).toBe(200);

  await openProject(page, 'Linked Project');
  await page.getByRole('button', { name: 'AI Chat' }).click();
  const ask = async (text: string) => {
    await page.getByPlaceholder('Ask about your diagram...').fill(text);
    await page.getByRole('button', { name: 'Send' }).click();
  };

  // Text in a diagram can't point it at anything else the account reaches
  await ask(`read ${other}:README.md`);
  await expect(page.getByText(/Couldn't read it: .* isn't linked to this project/)).toBeVisible();
  await expect(page.getByText(`Linked: ${linked}.`, { exact: false })).toBeVisible();
  await expect(page.getByText('TOP SECRET plans')).toHaveCount(0);

  await ask(`read ${linked}:README.md`);
  await expect(page.getByText('It says: Payments talks to Stripe.')).toBeVisible();
});

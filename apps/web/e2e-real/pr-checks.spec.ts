import { test, expect, type APIRequestContext } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GITHUB_APP_WEBHOOK_SECRET, GITHUB_URL, WEB_URL } from '../playwright.real.config';
import {
  API_URL,
  apiCreateProject,
  apiGetDiagram,
  getActiveElements,
  isConnected,
  openProject,
  registerUser,
  type TestUser,
} from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Every file under a fixture folder: path → contents. */
function readTree(dir: string, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) for (const [k, v] of readTree(full, rel)) out.set(k, v);
    else out.set(rel, readFileSync(full, 'utf8'));
  }
  return out;
}

/** The pull request that turns shop-v1 into shop-v2, as GitHub lists its files. */
function pullRequestFiles(before: Map<string, string>, after: Map<string, string>) {
  const files: Array<{ filename: string; status: string }> = [];
  for (const [p, text] of after) {
    if (!before.has(p)) files.push({ filename: p, status: 'added' });
    else if (before.get(p) !== text) files.push({ filename: p, status: 'modified' });
  }
  for (const p of before.keys()) if (!after.has(p)) files.push({ filename: p, status: 'removed' });
  return files;
}

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });

/** Connect the user's GitHub account through the real OAuth endpoints (against the fake host). */
async function connectGitHub(request: APIRequestContext, user: TestUser): Promise<string> {
  const start = await request.get(
    `${API_URL}/api/github/authorize?enterpriseUrl=${encodeURIComponent(GITHUB_URL)}`,
    { headers: auth(user) },
  );
  expect(start.status(), await start.text()).toBe(200);
  const state = new URL(((await start.json()) as { url: string }).url).searchParams.get('state')!;
  const done = await request.post(`${API_URL}/api/github/callback`, {
    headers: auth(user),
    data: { code: 'e2e-oauth-code', state },
  });
  expect(done.status(), await done.text()).toBe(200);
  return ((await done.json()) as { connection: { id: string } }).connection.id;
}

async function deliver(
  request: APIRequestContext,
  event: string,
  payload: unknown,
  secret = GITHUB_APP_WEBHOOK_SECRET,
) {
  const body = JSON.stringify(payload);
  return request.post(`${API_URL}/api/github-app/webhook`, {
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    data: body,
  });
}

const commentsOn = async (request: APIRequestContext, repo: string, n: number) =>
  (
    (await (await request.get(`${GITHUB_URL}/__test/comments?repo=${repo}&n=${n}`)).json()) as {
      comments: Array<{ id: number; body: string; edits: number }>;
    }
  ).comments;

test('a pull request is checked against the map, commented on, and its update applied', async ({
  page,
  context,
}) => {
  // A repository of its own, so maps from other runs don't join in
  const repoName = `shop-${Date.now().toString(36)}`;
  const fullName = `acme/${repoName}`;
  const v1 = readTree(path.join(here, 'fixtures', 'shop-v1'));
  const v2 = readTree(path.join(here, 'fixtures', 'shop-v2'));

  // The repository on GitHub, with a pull request turning v1 into v2
  const setUp = await context.request.post(`${GITHUB_URL}/__test/repo`, {
    data: {
      repo: fullName,
      trees: { base1: Array.from(v1.keys()) },
      contents: {
        base1: Object.fromEntries(v1),
        head1: Object.fromEntries(v2),
        head2: Object.fromEntries(v2),
      },
      pulls: { 7: pullRequestFiles(v1, v2) },
    },
  });
  expect(setUp.status()).toBe(200);

  // An architect maps the repository (v1), from GitHub
  const user = await registerUser(context, 'Architect');
  const project = await apiCreateProject(context.request, user, 'Shop Architecture');
  await openProject(page, 'Shop Architecture');
  await page.getByRole('button', { name: /^Code/ }).click();
  await page.getByTestId('repo-folder-input').setInputFiles(path.join(here, 'fixtures', 'shop-v1'));
  await expect(page.getByTestId('toast').filter({ hasText: 'Mapped shop-v1' })).toBeVisible();
  const saved = (await (
    await context.request.get(`${API_URL}/api/projects/${project.id}`, { headers: auth(user) })
  ).json()) as { project: { repoSource: { model: unknown } } };

  // Linking the map to acme/shop needs a GitHub connection that can see it
  const connectionId = await connectGitHub(context.request, user);
  const link = (repo: string) =>
    context.request.put(`${API_URL}/api/projects/${project.id}/repo`, {
      headers: auth(user),
      data: {
        kind: 'github',
        label: `${repo}@main`,
        owner: repo.split('/')[0],
        repo: repo.split('/')[1],
        ref: 'main',
        connectionId,
        model: saved.project.repoSource.model,
      },
    });
  expect((await link('acme/secret')).status()).toBe(403);
  // Read access alone (anyone can read a public repository) links the map
  // for drift checks, but never turns on pull-request comments
  const readOnly = `${fullName}-readonly`;
  await context.request.post(`${GITHUB_URL}/__test/repo`, {
    data: { repo: readOnly, trees: {}, contents: {}, pulls: {}, push: false },
  });
  const viaRead = await link(readOnly);
  expect(viaRead.status()).toBe(200);
  expect(
    ((await viaRead.json()) as { repoSource: { host?: string } }).repoSource.host,
  ).toBeUndefined();
  await page.reload();
  await page.getByRole('button', { name: /^Code/ }).click();
  await expect(page.getByTestId('pr-checks-off')).toContainText('can push to');
  await page.keyboard.press('Escape');

  const linked = await link(fullName);
  expect(linked.status()).toBe(200);
  expect(((await linked.json()) as { repoSource: { host?: string } }).repoSource.host).toBe(
    GITHUB_URL,
  );

  // The Code dialog explains pull request checks
  await page.reload();
  await page.getByRole('button', { name: /^Code/ }).click();
  const checks = page.getByTestId('pr-checks');
  await expect(checks).toContainText(`Every pull request on ${fullName}`);
  await expect(
    checks.getByRole('link', { name: `Install the GitHub App on ${fullName}` }),
  ).toHaveAttribute('href', `${GITHUB_URL}/apps/mavisdraw-e2e/installations/new`);
  await page.keyboard.press('Escape');
  await isConnected(page);

  // A pull request is opened on GitHub
  const pr = {
    action: 'opened',
    installation: { id: 99 },
    repository: { full_name: fullName, name: repoName, owner: { login: 'acme' } },
    pull_request: {
      number: 7,
      title: 'Billing and an assistant',
      html_url: `https://github.com/${fullName}/pull/7`,
      base: { sha: 'base1' },
      head: { sha: 'head1' },
    },
  };
  expect((await deliver(context.request, 'pull_request', pr, 'not-the-secret')).status()).toBe(401);
  expect((await deliver(context.request, 'pull_request', pr)).status()).toBe(202);

  // One comment on the PR: what it touches and how it changes the architecture
  await expect.poll(async () => (await commentsOn(context.request, fullName, 7)).length).toBe(1);
  const [comment] = await commentsOn(context.request, fullName, 7);
  expect(comment.body).toContain('<!-- mavisdraw:pr-map -->');
  expect(comment.body).toMatch(/Touches \*\*(api|api-client|storefront)\*\*/);
  expect(comment.body).toContain(
    'New package in the code: billing (packages/billing) — _not on the map yet_',
  );
  expect(comment.body).toContain('api now uses Anthropic API — _not on the map yet_');
  expect(comment.body).toContain(
    'api-client is gone from the code (packages/api-client) — _still on the map_',
  );
  const reviewLink = /\(([^)]+\?proposals=open)\)/.exec(comment.body)![1];
  expect(reviewLink).toBe(`${WEB_URL}/p/${project.id}?proposals=open`);

  // The open editor hears about the proposal at once
  await expect(page.getByRole('button', { name: 'Proposals · 1' })).toBeVisible({
    timeout: 10_000,
  });

  // Following the comment's link lands on the review
  await page.goto(reviewLink);
  const card = page.getByTestId('proposal');
  await expect(card).toContainText('Pull request');
  await expect(card).toContainText(`${fullName}#7`);
  await expect(card).toContainText('“Billing and an assistant” changes the architecture');
  await expect(card).toContainText('Add "billing" (portal)');
  await expect(card).toContainText('Delete "api-client"');
  await expect(card.getByRole('link', { name: 'View source' })).toHaveAttribute(
    'href',
    `https://github.com/${fullName}/pull/7`,
  );
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Applied' })).toContainText(
    '2 added, 2 connected, 1 removed',
  );
  await expect
    .poll(async () => {
      const els = await getActiveElements(page);
      const billing = els.find((e) => e.type === 'portal' && e.label === 'billing');
      return {
        billing: billing?.codePath ?? null,
        anthropic: els.some((e) => e.type === 'text' && e.text === 'Anthropic API'),
        apiClient: els.some((e) => e.type === 'portal' && e.label === 'api-client'),
      };
    })
    .toEqual({ billing: 'packages/billing', anthropic: true, apiClient: false });

  // A new push: the same comment is updated, and the map is now in line
  // …once the applied update has reached the server
  await expect
    .poll(async () => {
      const { diagram } = await apiGetDiagram(context.request, user, project.rootDiagramId);
      return (diagram?.elements ?? []).some((e) => e.type === 'portal' && e.label === 'billing');
    })
    .toBe(true);
  const pushed = {
    ...pr,
    action: 'synchronize',
    pull_request: { ...pr.pull_request, head: { sha: 'head2' } },
  };
  expect((await deliver(context.request, 'pull_request', pushed)).status()).toBe(202);
  await expect
    .poll(async () => (await commentsOn(context.request, fullName, 7))[0]?.body ?? '')
    .toContain('Updated for head2');
  const after = await commentsOn(context.request, fullName, 7);
  expect(after).toHaveLength(1);
  expect(after[0].edits).toBeGreaterThanOrEqual(1);
  expect(after[0].body).not.toContain('not on the map yet');
  expect(after[0].body).not.toContain('Review the proposed map update');
});

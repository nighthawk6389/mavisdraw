import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const API_URL = `http://localhost:${process.env.E2E_API_PORT ?? '3101'}`;
/** The fake GitHub Enterprise host (e2e-real/fake-github.mjs). */
export const GITHUB_URL = `http://localhost:${process.env.E2E_GITHUB_PORT ?? '3102'}`;
/** The API serving the built app on its own address, as on Render (WEB_DIST). */
export const SINGLE_SITE_URL = `http://localhost:${process.env.E2E_SINGLE_PORT ?? '3103'}`;

export interface TestUser {
  email: string;
  password: string;
  name: string;
  accessToken: string;
}

let counter = 0;

/** Unique, human-readable test email. */
function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 7)}@e2e.mavisdraw.dev`;
}

/**
 * Register a brand-new user through the real API using the browser context's
 * request client, so the httpOnly refresh cookie lands in the context's jar
 * and the app's startup refresh logs the user in.
 */
export async function registerUser(
  context: BrowserContext,
  name = 'E2E User',
  prefix = 'user',
  options: { email?: string; verify?: boolean } = {},
): Promise<TestUser> {
  const email = options.email ?? uniqueEmail(prefix);
  const password = 'correct-horse-battery';
  const res = await context.request.post(`${API_URL}/api/auth/register`, {
    data: { email, password, name },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { accessToken: string };
  // Like a real person: open the confirmation email (unless the test is about not doing that)
  if (options.verify !== false) await confirmEmail(context.request, email);
  return { email, password, name, accessToken: body.accessToken };
}

/** Follow the confirmation link emailed to `email` (through the API). */
export async function confirmEmail(request: APIRequestContext, email: string): Promise<void> {
  const sent = await waitForEmail(request, email, /Confirm your email/);
  const token = new URL(linkIn(sent)).searchParams.get('token');
  const res = await request.post(`${API_URL}/api/auth/verify-email`, { data: { token } });
  expect(res.status(), await res.text()).toBe(200);
}

export async function apiCreateProject(
  request: APIRequestContext,
  user: TestUser,
  name: string,
): Promise<{ id: string; rootDiagramId: string }> {
  const res = await request.post(`${API_URL}/api/projects`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
    data: { name },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { project: { id: string; rootDiagramId: string } };
  return body.project;
}

export async function apiGetDiagram(
  request: APIRequestContext,
  user: TestUser,
  diagramId: string,
): Promise<{ status: number; diagram?: { elements: Array<Record<string, unknown>> } }> {
  const res = await request.get(`${API_URL}/api/diagrams/${diagramId}`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
  });
  if (!res.ok()) return { status: res.status() };
  const body = (await res.json()) as { diagram: { elements: Array<Record<string, unknown>> } };
  return { status: res.status(), diagram: body.diagram };
}

export async function apiListDiagrams(
  request: APIRequestContext,
  user: TestUser,
  projectId: string,
): Promise<Array<{ id: string; parentDiagramId: string | null; title: string }>> {
  const res = await request.get(`${API_URL}/api/projects/${projectId}/diagrams`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = (await res.json()) as {
    diagrams: Array<{ id: string; parentDiagramId: string | null; title: string }>;
  };
  return body.diagrams;
}

/** Open the dashboard and click into a project by name. */
export async function openProject(page: Page, projectName: string): Promise<void> {
  await page.goto('/');
  await page.getByText(projectName, { exact: true }).click();
  await expect(page.locator('canvas').first()).toBeVisible();
}

/** The interactive (top) canvas receives pointer events. */
export function interactiveCanvas(page: Page) {
  return page.locator('canvas').nth(1);
}

/** Drag on the canvas in page coordinates relative to the canvas box. */
export async function dragOnCanvas(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
): Promise<void> {
  const box = await interactiveCanvas(page).boundingBox();
  if (!box) throw new Error('canvas not visible');
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps });
  await page.mouse.up();
}

/** Read elements of the active diagram from the dev-only test hook. */
export async function getActiveElements(page: Page): Promise<
  Array<{
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    [k: string]: unknown;
  }>
> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __MAVISDRAW__?: { getActiveElements: () => unknown[] } })
      .__MAVISDRAW__;
    if (!hook) throw new Error('__MAVISDRAW__ test hook missing (dev build only)');
    return hook.getActiveElements() as never;
  });
}

/** Wait until the save indicator reports a successful save. */
export async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });
}

/** Screen (page) coordinates of an element's centre, honouring pan/zoom. */
export async function screenCenterOf(
  page: Page,
  el: { x: number; y: number; width: number; height: number },
): Promise<{ x: number; y: number }> {
  const vp = await page.evaluate(() =>
    (
      window as unknown as {
        __MAVISDRAW__: { getViewport: () => { zoom: number; scrollX: number; scrollY: number } };
      }
    ).__MAVISDRAW__.getViewport(),
  );
  const box = (await interactiveCanvas(page).boundingBox())!;
  return {
    x: box.x + (el.x + el.width / 2) * vp.zoom + vp.scrollX,
    y: box.y + (el.y + el.height / 2) * vp.zoom + vp.scrollY,
  };
}

// ── Two people in one project (owner + someone who joined via a share link) ──

export async function shareLink(
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

export async function isConnected(page: Page) {
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

/** Drag between two page (not canvas-relative) points, e.g. from screenCenterOf. */
export async function dragPage(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

export const types = async (page: Page) =>
  (await getActiveElements(page)).map((e) => e.type).sort();

/** Owner + a second user who joined through a share link, both in the editor. */
export async function twoPeople(
  browser: Browser,
  role: 'viewer' | 'editor',
  names: { owner?: string; guest?: string } = {},
) {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const owner = await registerUser(ctxA, names.owner ?? 'Owner');
  const guest = await registerUser(ctxB, names.guest ?? (role === 'viewer' ? 'Viewer' : 'Editor'));
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

// ── Email (the API runs with MAIL_PROVIDER=outbox) ──

export interface SentEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Wait for an email to `to` whose subject matches, and return it. */
export async function waitForEmail(
  request: APIRequestContext,
  to: string,
  subject: RegExp,
): Promise<SentEmail> {
  let found: SentEmail | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API_URL}/api/test/outbox`);
        const { messages } = (await res.json()) as { messages: SentEmail[] };
        found = messages.reverse().find((m) => m.to === to && subject.test(m.subject));
        return !!found;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return found!;
}

/** The first link in an email's text that points at the web app. */
export function linkIn(email: SentEmail): string {
  const match = /https?:\/\/\S+/.exec(email.text);
  if (!match) throw new Error(`No link in email "${email.subject}"`);
  return match[0];
}

/**
 * Wait until everything `from` has sent over its live connection so far has
 * been through the server and reached `to`: `from` publishes a unique
 * awareness value (allowed even on read-only connections) and `to` waits to
 * see it. One connection's messages are handled in order, so a write `from`
 * sent earlier would have arrived first. Use this instead of sleeping before
 * asserting that a write did NOT get through.
 */
export async function liveBarrier(from: Page, to: Page): Promise<void> {
  const mark = `${Date.now()}-${Math.random()}`;
  await from.evaluate(async (value) => {
    const m = await import('/src/stores/collaborationStore.ts');
    m.useCollaborationStore.getState().provider!.setAwarenessField('e2eBarrier', value);
  }, mark);
  await expect
    .poll(
      () =>
        to.evaluate(async (value) => {
          const m = await import('/src/stores/collaborationStore.ts');
          const states = m.useCollaborationStore.getState().provider?.awareness?.getStates();
          return [...(states?.values() ?? [])].some(
            (s) => (s as { e2eBarrier?: string }).e2eBarrier === value,
          );
        }, mark),
      { timeout: 10_000 },
    )
    .toBe(true);
}

/** Connect the user's GitHub account through the real OAuth endpoints (against the fake host). */
export async function connectGitHub(request: APIRequestContext, user: TestUser): Promise<string> {
  const auth = { Authorization: `Bearer ${user.accessToken}` };
  const start = await request.get(
    `${API_URL}/api/github/authorize?enterpriseUrl=${encodeURIComponent(GITHUB_URL)}`,
    { headers: auth },
  );
  expect(start.status(), await start.text()).toBe(200);
  const state = new URL(((await start.json()) as { url: string }).url).searchParams.get('state')!;
  const done = await request.post(`${API_URL}/api/github/callback`, {
    headers: auth,
    data: { code: 'e2e-oauth-code', state },
  });
  expect(done.status(), await done.text()).toBe(200);
  return ((await done.json()) as { connection: { id: string } }).connection.id;
}

/**
 * Run one SQL statement against the suite's database, for what a test can't
 * wait for (moving an expiry into the past). Uses the server's own Postgres
 * client; the statement and its parameters travel as environment variables.
 */
export function runSql(statement: string, params: unknown[] = []): void {
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../server');
  const script = [
    "import postgres from 'postgres';",
    'const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });',
    'await sql.unsafe(process.env.E2E_SQL, JSON.parse(process.env.E2E_SQL_PARAMS));',
    'await sql.end();',
  ].join(' ');
  execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: serverDir,
    stdio: 'pipe',
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ??
        'postgresql://mavisdraw:mavisdraw_dev@localhost:5432/mavisdraw',
      E2E_SQL: statement,
      E2E_SQL_PARAMS: JSON.stringify(params),
    },
  });
}

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  API_URL,
  registerUser,
  apiCreateProject,
  openProject,
  dragOnCanvas,
  getActiveElements,
  type TestUser,
} from './helpers';

async function shareProject(
  context: BrowserContext,
  owner: TestUser,
  projectId: string,
  role: 'viewer' | 'editor',
): Promise<string> {
  const res = await context.request.post(`${API_URL}/api/projects/${projectId}/share`, {
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    data: { role },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { share: { shareToken: string } }).share.shareToken;
}

async function joinProject(context: BrowserContext, user: TestUser, token: string) {
  const res = await context.request.post(`${API_URL}/api/share/${token}`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function connected(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __MAVISDRAW__?: { getConnectionStatus?: () => string } }
        ).__MAVISDRAW__?.getConnectionStatus?.(),
      ),
    )
    .toBe('connected');
}

test.describe('Real-time collaboration', () => {
  test('two editors see each other’s shapes live', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const alice = await registerUser(ctxA, 'Alice');
    const bob = await registerUser(ctxB, 'Bob');
    const project = await apiCreateProject(ctxA.request, alice, 'Shared Board');
    await joinProject(ctxB, bob, await shareProject(ctxA, alice, project.id, 'editor'));

    await openProject(pageA, 'Shared Board');
    await openProject(pageB, 'Shared Board');
    await connected(pageA);
    await connected(pageB);

    await pageA.keyboard.press('r');
    await dragOnCanvas(pageA, { x: 150, y: 150 }, { x: 300, y: 250 });
    await expect
      .poll(async () => (await getActiveElements(pageB)).map((e) => e.type))
      .toEqual(['rectangle']);

    await pageB.keyboard.press('e');
    await dragOnCanvas(pageB, { x: 400, y: 150 }, { x: 500, y: 250 });
    await expect
      .poll(async () => (await getActiveElements(pageA)).map((e) => e.type).sort())
      .toEqual(['ellipse', 'rectangle']);

    await ctxA.close();
    await ctxB.close();
  });
});

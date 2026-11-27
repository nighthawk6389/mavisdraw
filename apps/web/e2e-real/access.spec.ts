import { test, expect } from '@playwright/test';
import {
  API_URL,
  apiCreateProject,
  apiGetDiagram,
  dragOnCanvas,
  getActiveElements,
  isConnected,
  liveBarrier,
  openProject,
  registerUser,
  shareLink,
  twoPeople,
  type TestUser,
} from './helpers';
import type { APIRequestContext } from '@playwright/test';

async function permissionOf(
  request: APIRequestContext,
  owner: TestUser,
  projectId: string,
  name: string,
) {
  const res = await request.get(`${API_URL}/api/projects/${projectId}/permissions`, {
    headers: { Authorization: `Bearer ${owner.accessToken}` },
  });
  const { permissions } = (await res.json()) as {
    permissions: Array<{ id: string; name: string | null }>;
  };
  const row = permissions.find((p) => p.name === name);
  if (!row) throw new Error(`no permission for ${name}`);
  return row.id;
}

test.describe('Access changes apply to open tabs', () => {
  test('someone removed from a project is disconnected and their edits go nowhere', async ({
    browser,
  }) => {
    const { ctxA, ctxB, a, b, owner, project } = await twoPeople(browser, 'editor');
    const permissionId = await permissionOf(ctxA.request, owner, project.id, 'Editor');

    const res = await ctxA.request.delete(`${API_URL}/api/permissions/${permissionId}`, {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
    });
    expect(res.status()).toBe(200);

    // Bob is told and taken back to his projects…
    await expect(b.getByTestId('toast').filter({ hasText: 'no longer have access' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(b).toHaveURL(/\/$/);

    // …and nothing he could still send reaches Alice
    await a.waitForTimeout(1000);
    expect(await getActiveElements(a)).toHaveLength(0);

    await ctxA.close();
    await ctxB.close();
  });

  test('someone downgraded to viewer becomes read-only without reloading', async ({ browser }) => {
    const { ctxA, ctxB, a, b, owner, project } = await twoPeople(browser, 'editor');
    const permissionId = await permissionOf(ctxA.request, owner, project.id, 'Editor');
    await expect(b.getByTestId('view-only-badge')).toHaveCount(0);

    const res = await ctxA.request.put(`${API_URL}/api/permissions/${permissionId}`, {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      data: { role: 'viewer' },
    });
    expect(res.status()).toBe(200);

    await expect(b.getByTestId('view-only-badge')).toBeVisible({ timeout: 10_000 });
    // Drawing tools are gone; even a forced write is refused by the server
    await expect(b.getByTestId('toolbar').locator('button[title^="Rectangle"]')).toHaveCount(0);
    await b.evaluate(async () => {
      const m = await import('/src/stores/collaborationStore.ts');
      const Y = await import('/node_modules/.vite/deps/yjs.js');
      const doc = m.useCollaborationStore.getState().doc!;
      const diagramId = (
        window as unknown as { __MAVISDRAW__: { getActiveDiagramId: () => string } }
      ).__MAVISDRAW__.getActiveDiagramId();
      // A complete shape on this diagram, so it would show if it got through
      const el = new Y.Map();
      for (const [k, v] of Object.entries({
        id: 'forged',
        type: 'rectangle',
        diagramId,
        x: 10,
        y: 10,
        width: 80,
        height: 60,
        version: 1,
        isDeleted: false,
      })) {
        el.set(k, v);
      }
      doc.getMap('elements').set('forged', el);
    });
    // Everything Bob sent has been through the server by now
    await liveBarrier(b, a);
    const reachedAlice = await a.evaluate(async () => {
      const m = await import('/src/stores/collaborationStore.ts');
      return m.useCollaborationStore.getState().doc!.getMap('elements').has('forged');
    });
    expect(reachedAlice).toBe(false);
    expect((await getActiveElements(a)).map((e) => e.id)).not.toContain('forged');

    await ctxA.close();
    await ctxB.close();
  });

  test('following your own share link never makes your open tabs read-only', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const owner = await registerUser(ctx, 'Owner');
    const name = `Own link ${Date.now().toString(36)}`;
    const project = await apiCreateProject(ctx.request, owner, name);
    const token = await shareLink(ctx, owner, project.id, 'viewer');
    await openProject(page, name);
    await isConnected(page);

    // The owner opens the viewer link they made (say, to check what guests see)
    const res = await ctx.request.post(`${API_URL}/api/share/${token}`, {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
    });
    expect(await res.json()).toMatchObject({ role: 'owner' });

    // The tab they already had open still edits, and the edit is saved
    await page.evaluate(() =>
      (
        window as unknown as { __MAVISDRAW__: { seedRectangles: (n: number) => void } }
      ).__MAVISDRAW__.seedRectangles(1),
    );
    await expect
      .poll(
        async () =>
          (await apiGetDiagram(ctx.request, owner, project.rootDiagramId)).diagram?.elements.length,
        { timeout: 15_000 },
      )
      .toBe(1);
    await expect(page.getByTestId('view-only-badge')).toHaveCount(0);
    await ctx.close();
  });

  test('a share link can never grant admin', async ({ browser }) => {
    const { ctxA, ctxB, owner, project } = await twoPeople(browser, 'viewer');
    const res = await ctxA.request.post(`${API_URL}/api/projects/${project.id}/share`, {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      data: { role: 'editor' },
    });
    const { share } = (await res.json()) as { share: { id: string } };
    const put = await ctxA.request.put(`${API_URL}/api/permissions/${share.id}`, {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      data: { role: 'admin' },
    });
    expect(put.status()).toBe(400);
    await ctxA.close();
    await ctxB.close();
  });

  test('an editor link upgrades someone who is already a viewer', async ({ browser }) => {
    const { ctxA, ctxB, b, owner, project } = await twoPeople(browser, 'viewer');
    await expect(b.getByTestId('view-only-badge')).toBeVisible();
    const res = await ctxA.request.post(`${API_URL}/api/projects/${project.id}/share`, {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      data: { role: 'editor' },
    });
    const { share } = (await res.json()) as { share: { shareToken: string } };
    await b.goto(`/share/${share.shareToken}`);
    await expect(b.locator('canvas').first()).toBeVisible();
    await expect(b.getByTestId('view-only-badge')).toHaveCount(0);
    await b.keyboard.press('r');
    await dragOnCanvas(b, { x: 150, y: 150 }, { x: 300, y: 250 });
    expect(await getActiveElements(b)).toHaveLength(1);
    await ctxA.close();
    await ctxB.close();
  });

  test('an unauthenticated socket cannot make the server buffer large messages', async () => {
    const ws = new WebSocket(`${API_URL.replace('http', 'ws')}/collaboration`);
    ws.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('socket error'));
    });
    const closed = new Promise<number>((resolve) => {
      ws.onclose = (e) => resolve(e.code);
    });
    for (let i = 0; i < 4; i++) ws.send(new Uint8Array(128 * 1024));
    expect(await closed).toBe(1009);
  });
});

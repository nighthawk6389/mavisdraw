import { test, expect, type Page } from '@playwright/test';
import {
  API_URL,
  apiCreateProject,
  apiGetDiagram,
  dragOnCanvas,
  dragPage,
  getActiveElements,
  isConnected,
  openProject,
  registerUser,
  screenCenterOf,
  twoPeople,
} from './helpers';

const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

const status = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __MAVISDRAW__?: { getConnectionStatus: () => string } }
    ).__MAVISDRAW__?.getConnectionStatus(),
  );

/** Drop this tab's live connection (and keep it down) — like a flaky network. */
async function goOffline(page: Page) {
  await page.evaluate(async () => {
    const m = await import('/src/stores/collaborationStore.ts');
    // Close the socket itself and stop it reconnecting
    const provider = m.useCollaborationStore.getState().provider as unknown as {
      configuration: { websocketProvider: { disconnect: () => void } };
    };
    provider.configuration.websocketProvider.disconnect();
  });
  await expect.poll(() => status(page)).toBe('disconnected');
}

/** Reconnect a tab that went offline (it keeps its copy of the document). */
async function goOnline(page: Page) {
  await page.evaluate(async () => {
    const m = await import('/src/stores/collaborationStore.ts');
    const provider = m.useCollaborationStore.getState().provider as unknown as {
      configuration: { websocketProvider: { connect: () => Promise<void> } };
    };
    void provider.configuration.websocketProvider.connect();
  });
  await isConnected(page);
}

test.describe('Sync integrity', () => {
  test('a rejected token on reconnect recovers instead of silently going dark', async ({
    browser,
  }) => {
    const { ctxA, ctxB, a, b, owner, project } = await twoPeople(browser, 'editor');

    // Alice's tab now holds a token the server will reject (like one that
    // expired across a server restart), and her connection drops
    await a.evaluate(async () => {
      const api = await import('/src/services/api.ts');
      const future = Math.floor(Date.now() / 1000) + 3600;
      const payload = btoa(JSON.stringify({ userId: 'x', exp: future })).replace(/=+$/, '');
      api.setAccessToken(`eyJhbGciOiJIUzI1NiJ9.${payload}.invalid-signature`);
      const m = await import('/src/stores/collaborationStore.ts');
      const provider = m.useCollaborationStore.getState().provider!;
      provider.disconnect();
      await provider.connect();
    });

    // It must not pretend to be live while rejected; it refreshes and rejoins
    await isConnected(a);

    // …and her next edit really reaches Bob and the server
    await a.keyboard.press('r');
    await dragOnCanvas(a, { x: 150, y: 150 }, { x: 300, y: 250 });
    await expect.poll(async () => (await getActiveElements(b)).length).toBe(1);
    await expect
      .poll(
        async () =>
          (
            (await apiGetDiagram(ctxA.request, owner, project.rootDiagramId)).diagram?.elements ??
            []
          ).length,
        { timeout: 20_000 },
      )
      .toBe(1);

    await ctxA.close();
    await ctxB.close();
  });

  test('a shape undone while a teammate is elsewhere stays deleted', async ({ browser }) => {
    const { ctxA, ctxB, a, b, owner, project } = await twoPeople(browser, 'editor');

    // Bob draws a portal, and Alice draws a box Bob can see
    await b.keyboard.press('o');
    await dragOnCanvas(b, { x: 420, y: 300 }, { x: 560, y: 400 });
    await a.keyboard.press('r');
    await dragOnCanvas(a, { x: 150, y: 150 }, { x: 300, y: 250 });
    await expect.poll(async () => (await getActiveElements(b)).length).toBe(2);

    // Bob drills into his portal; meanwhile Alice undoes her box
    const portal = (await getActiveElements(b)).find((e) => e.type === 'portal')!;
    const pc = await screenCenterOf(b, portal);
    await b.mouse.dblclick(pc.x, pc.y);
    await expect(b).toHaveURL(new RegExp(`/d/${portal.targetDiagramId}$`));
    await a.keyboard.press(undo);
    await expect
      .poll(async () => (await getActiveElements(a)).map((e) => e.type))
      .toEqual(['portal']);

    // Bob comes back up: the box must not reappear — not for him, not for Alice, not on the server
    await b.waitForTimeout(2500); // let Bob's autosave run while he was away
    await b.keyboard.press('Escape');
    await b.keyboard.press('Backspace');
    await expect(b).toHaveURL(new RegExp(`/p/${project.id}$`));
    await isConnected(b);
    await b.waitForTimeout(1000);
    for (const page of [a, b]) {
      expect((await getActiveElements(page)).map((e) => e.type)).toEqual(['portal']);
    }
    await expect
      .poll(
        async () =>
          (
            (await apiGetDiagram(ctxA.request, owner, project.rootDiagramId)).diagram?.elements ??
            []
          ).filter((e) => e.type === 'rectangle').length,
        { timeout: 15_000 },
      )
      .toBe(0);

    await ctxA.close();
    await ctxB.close();
  });

  test('a version restored while nobody is in the room holds when a tab that missed it returns', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const owner = await registerUser(ctx, 'Owner');
    const name = `Restore ${Date.now()}`;
    const project = await apiCreateProject(ctx.request, owner, name);
    const d = project.rootDiagramId;
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const storedBoxes = async () =>
      ((await apiGetDiagram(ctx.request, owner, d)).diagram?.elements ?? []).filter(
        (e) => e.type === 'rectangle',
      ).length;
    await openProject(page, name);
    await isConnected(page);

    // One box, kept as a version; then a second box
    await page.keyboard.press('r');
    await dragOnCanvas(page, { x: 150, y: 150 }, { x: 300, y: 250 });
    await expect.poll(storedBoxes).toBe(1);
    const saved = await ctx.request.post(`${API_URL}/api/diagrams/${d}/save`, {
      headers: auth,
      data: { label: 'One box' },
    });
    const { snapshot } = (await saved.json()) as { snapshot: { id: string } };
    await page.keyboard.press('r');
    await dragOnCanvas(page, { x: 400, y: 300 }, { x: 550, y: 400 });
    await expect.poll(storedBoxes).toBe(2);

    // The tab drops out of the live room; with nobody left, the room saves and closes
    await goOffline(page);
    await page.waitForTimeout(1000);

    // The version is restored with no room open
    const restored = await ctx.request.post(
      `${API_URL}/api/diagrams/${d}/snapshots/${snapshot.id}/restore`,
      { headers: auth },
    );
    expect(restored.status(), await restored.text()).toBe(200);
    expect(await storedBoxes()).toBe(1);

    // The tab comes back with its copy from before the restore: the restore holds
    await goOnline(page);
    await expect
      .poll(async () => (await getActiveElements(page)).filter((e) => e.type === 'rectangle'))
      .toHaveLength(1);
    await page.waitForTimeout(1500); // the room saves what it merged
    expect(await storedBoxes()).toBe(1);
    expect((await getActiveElements(page)).filter((e) => e.type === 'rectangle')).toHaveLength(1);
    await ctx.close();
  });

  test('an edit from a tab that fell out of the room never overwrites newer work', async ({
    browser,
  }) => {
    const { ctxA, ctxB, a, b, owner, project } = await twoPeople(browser, 'editor');

    await a.keyboard.press('r');
    await dragOnCanvas(a, { x: 150, y: 150 }, { x: 300, y: 250 });
    await expect.poll(async () => (await getActiveElements(b)).length).toBe(1);
    await b.waitForTimeout(2000); // Bob's tab has recorded what the server has

    // Bob's connection drops. Alice keeps working: she drags the box right
    await goOffline(b);
    const [box] = await getActiveElements(a);
    let c = await screenCenterOf(a, box);
    await dragPage(a, c, { x: c.x + 200, y: c.y });
    await expect.poll(async () => (await getActiveElements(a))[0].x).toBeGreaterThan(box.x + 100);
    const aliceX = (await getActiveElements(a))[0].x;

    // Bob, from his old copy, drags it down. His save goes over REST…
    c = await screenCenterOf(b, (await getActiveElements(b))[0]);
    await dragPage(b, c, { x: c.x, y: c.y + 150 });

    // …and is refused as a conflict: Bob is told, and sees Alice's newer version
    await expect(
      b.getByTestId('toast').filter({ hasText: 'kept their newer version' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await getActiveElements(b))[0].x).toBe(aliceX);
    const saved = await apiGetDiagram(ctxA.request, owner, project.rootDiagramId);
    expect((saved.diagram?.elements ?? [])[0].x).toBe(aliceX);
    expect((await getActiveElements(a))[0].x).toBe(aliceX);

    await ctxA.close();
    await ctxB.close();
  });
});

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  API_URL,
  apiCreateProject,
  apiGetDiagram,
  apiListDiagrams,
  dragOnCanvas,
  dragPage,
  getActiveElements,
  isConnected,
  openProject,
  registerUser,
  screenCenterOf,
  shareLink,
  twoPeople,
  type TestUser,
} from './helpers';

/**
 * Lose the network: no HTTP, and the live socket drops too. Chromium's
 * offline mode leaves open sockets alone, so the app's socket is closed by
 * hand, and again while waiting in case it was being replaced just then.
 */
async function goOffline(context: BrowserContext, page: Page) {
  const dropSocket = () =>
    page.evaluate(async () => {
      const m = await import('/src/stores/collaborationStore.ts');
      const provider = m.useCollaborationStore.getState().provider as unknown as {
        configuration: { websocketProvider: { disconnect: () => void } };
      } | null;
      provider?.configuration.websocketProvider.disconnect();
      return (
        window as unknown as { __MAVISDRAW__?: { getConnectionStatus: () => string } }
      ).__MAVISDRAW__?.getConnectionStatus();
    });
  await dropSocket();
  await context.setOffline(true);
  // Really offline: the live connection is down too
  await expect.poll(dropSocket).toBe('disconnected');
}

/**
 * This tab will die the way it does in a crash or an out-of-memory kill:
 * no unload handlers ever run (the app's pagehide/visibilitychange flushes
 * are never registered). Call before the app loads.
 */
async function noUnloadEvents(page: Page) {
  await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (['pagehide', 'visibilitychange', 'beforeunload', 'unload'].includes(type)) return;
      add.call(this, type, listener, options);
    };
  });
}

/**
 * Kill the tab: it sends nothing more. (A closing tab can otherwise linger
 * long enough to reconnect and save the edit itself.)
 */
async function killTab(page: Page) {
  await page.route('**/*', (route) => route.abort());
  await page.routeWebSocket(/.*/, (ws) => ws.close());
  await page.close();
}

/** Sign in as someone on this browser (their session cookie replaces the last one). */
async function signInAs(context: BrowserContext, user: TestUser) {
  await context.clearCookies();
  const res = await context.request.post(`${API_URL}/api/auth/login`, {
    data: { email: user.email, password: user.password },
  });
  expect(res.status(), await res.text()).toBe(200);
}

const recovered = (page: Page, text = 'Recovered') =>
  page.getByTestId('toast').filter({ hasText: text });

test.describe('Offline', () => {
  test('edits made offline survive closing the tab, and save once back online', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await noUnloadEvents(page);
    const user = await registerUser(context, 'Offline User');
    const project = await apiCreateProject(context.request, user, 'Offline Project');
    await openProject(page, 'Offline Project');
    await isConnected(page);

    await page.keyboard.press('r');
    await dragOnCanvas(page, { x: 150, y: 150 }, { x: 300, y: 250 });
    const serverCount = async () =>
      ((await apiGetDiagram(context.request, user, project.rootDiagramId)).diagram?.elements ?? [])
        .length;
    await expect.poll(serverCount, { timeout: 20_000 }).toBe(1);

    // The train goes into a tunnel
    await goOffline(context, page);
    await page.keyboard.press('e');
    await dragOnCanvas(page, { x: 400, y: 150 }, { x: 520, y: 250 });
    await expect(page.getByTestId('offline-indicator')).toContainText('kept on this device');
    // The edit exists only in this tab (and its journal)…
    expect(await serverCount()).toBe(1);
    // …then the tab is killed
    await killTab(page);

    // Later, back online, the project is opened again
    await context.setOffline(false);
    const again = await context.newPage();
    await openProject(again, 'Offline Project');
    await expect(
      again.getByTestId('toast').filter({ hasText: 'Recovered 1 unsaved change' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => (await getActiveElements(again)).map((e) => e.type).sort())
      .toEqual(['ellipse', 'rectangle']);
    await expect.poll(serverCount, { timeout: 20_000 }).toBe(2);

    await context.close();
  });

  test('an edit survives even when the tab dies before IndexedDB finishes writing', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await noUnloadEvents(page);
    // A slow disk: in this tab, IndexedDB writes never complete (reads still work)
    await page.addInitScript(() => {
      const never = function () {
        return {} as IDBRequest;
      };
      IDBObjectStore.prototype.put = never as unknown as IDBObjectStore['put'];
      IDBObjectStore.prototype.delete = never as unknown as IDBObjectStore['delete'];
    });
    const user = await registerUser(context, 'Slow Disk User');
    const project = await apiCreateProject(context.request, user, 'Slow Disk Project');
    await openProject(page, 'Slow Disk Project');
    await isConnected(page);
    const serverCount = async () =>
      ((await apiGetDiagram(context.request, user, project.rootDiagramId)).diagram?.elements ?? [])
        .length;

    await goOffline(context, page);
    await page.keyboard.press('e');
    await dragOnCanvas(page, { x: 400, y: 150 }, { x: 520, y: 250 });
    await expect(page.getByTestId('offline-indicator')).toContainText('kept on this device');
    expect(await serverCount()).toBe(0);
    // Killed right after the edit: only the synchronous backup can have it
    await killTab(page);

    await context.setOffline(false);
    const again = await context.newPage();
    await openProject(again, 'Slow Disk Project');
    await expect(
      again.getByTestId('toast').filter({ hasText: 'Recovered 1 unsaved change' }),
    ).toBeVisible({ timeout: 15_000 });
    // The drag's final size came back, not a half-drawn shape
    const [ellipse] = await getActiveElements(again);
    expect(ellipse).toMatchObject({ type: 'ellipse' });
    expect(ellipse.width).toBeGreaterThan(100);
    await expect.poll(serverCount, { timeout: 20_000 }).toBe(1);

    await context.close();
  });

  test('an offline edit a teammate superseded is not brought back', async ({ browser }) => {
    const { ctxA, ctxB, a, b, owner, project } = await twoPeople(browser, 'editor');

    await a.keyboard.press('r');
    await dragOnCanvas(a, { x: 150, y: 150 }, { x: 300, y: 250 });
    await expect.poll(async () => (await getActiveElements(b)).length).toBe(1);
    await b.waitForTimeout(1500);
    const [original] = await getActiveElements(a);

    // Bob loses the network and drags the box down
    await goOffline(ctxB, b);
    let c = await screenCenterOf(b, original);
    await dragPage(b, c, { x: c.x, y: c.y + 150 });
    await expect(b.getByTestId('offline-indicator')).toBeVisible();
    await b.waitForTimeout(600);

    // Meanwhile Alice drags it to the right
    c = await screenCenterOf(a, original);
    await dragPage(a, c, { x: c.x + 200, y: c.y });
    await expect
      .poll(async () => (await getActiveElements(a))[0].x)
      .toBeGreaterThan(original.x + 100);
    const aliceX = (await getActiveElements(a))[0].x;
    await expect
      .poll(
        async () =>
          ((await apiGetDiagram(ctxA.request, owner, project.rootDiagramId)).diagram?.elements ??
            [])[0]?.x,
        { timeout: 20_000 },
      )
      .toBe(aliceX);

    // Bob closes his laptop, then reopens the project later
    await b.close();
    await ctxB.setOffline(false);
    const b2 = await ctxB.newPage();
    await b2.goto(`/p/${project.id}`);
    await expect(
      b2.getByTestId('toast').filter({ hasText: 'a teammate changed that shape since' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await getActiveElements(b2))[0]?.x).toBe(aliceX);
    expect((await getActiveElements(b2))[0].y).toBe(original.y);

    await ctxA.close();
    await ctxB.close();
  });
  test('two tabs offline each keep their own edits', async ({ browser }) => {
    const context = await browser.newContext();
    const one = await context.newPage();
    const two = await context.newPage();
    await noUnloadEvents(one);
    await noUnloadEvents(two);
    const user = await registerUser(context, 'Two Tabs');
    const project = await apiCreateProject(context.request, user, `Two tabs ${Date.now()}`);
    for (const page of [one, two]) {
      await page.goto(`/p/${project.id}`);
      await isConnected(page);
    }
    await goOffline(context, one);
    await goOffline(context, two);
    await one.keyboard.press('r');
    await dragOnCanvas(one, { x: 150, y: 150 }, { x: 300, y: 250 });
    await two.keyboard.press('e');
    await dragOnCanvas(two, { x: 400, y: 150 }, { x: 520, y: 250 });
    for (const page of [one, two]) {
      await expect(page.getByTestId('offline-indicator')).toContainText('kept on this device');
    }
    await killTab(one);
    await killTab(two);

    // Back online, one tab opens the project: both tabs' edits come back
    await context.setOffline(false);
    const again = await context.newPage();
    await again.goto(`/p/${project.id}`);
    await expect(recovered(again, 'Recovered 2 unsaved changes')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => (await getActiveElements(again)).map((e) => e.type).sort())
      .toEqual(['ellipse', 'rectangle']);
    await expect
      .poll(
        async () =>
          (
            (await apiGetDiagram(context.request, user, project.rootDiagramId)).diagram?.elements ??
            []
          ).length,
        { timeout: 20_000 },
      )
      .toBe(2);
    await context.close();
  });

  test('the next person to sign in on this browser never gets them', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await noUnloadEvents(page);
    const alice = await registerUser(context, 'Alice Shared');
    const project = await apiCreateProject(context.request, alice, `Shared PC ${Date.now()}`);
    const token = await shareLink(context, alice, project.id, 'editor');
    await page.goto(`/p/${project.id}`);
    await isConnected(page);
    await goOffline(context, page);
    await page.keyboard.press('e');
    await dragOnCanvas(page, { x: 400, y: 150 }, { x: 520, y: 250 });
    await expect(page.getByTestId('offline-indicator')).toContainText('kept on this device');
    await killTab(page);

    // Bob signs in on the same browser and opens the same project: nothing of Alice's
    await context.setOffline(false);
    await context.clearCookies();
    await registerUser(context, 'Bob Shared');
    const bob = await context.newPage();
    await bob.goto(`/share/${token}`);
    await expect(bob.locator('canvas').first()).toBeVisible();
    await isConnected(bob);
    await expect(recovered(bob)).toHaveCount(0);
    expect(await getActiveElements(bob)).toEqual([]);
    await bob.close();

    // Alice, back on this browser, still gets hers
    await signInAs(context, alice);
    const back = await context.newPage();
    await back.goto(`/p/${project.id}`);
    await expect(recovered(back, 'Recovered 1 unsaved change')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => (await getActiveElements(back)).map((e) => e.type))
      .toEqual(['ellipse']);
    await context.close();
  });

  test('signing out with unsaved edits asks first, then discards them', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const user = await registerUser(context, 'Leaving User');
    const project = await apiCreateProject(context.request, user, `Sign out ${Date.now()}`);
    await page.goto(`/p/${project.id}`);
    await isConnected(page);
    await goOffline(context, page);
    await page.keyboard.press('e');
    await dragOnCanvas(page, { x: 400, y: 150 }, { x: 520, y: 250 });
    await expect(page.getByTestId('offline-indicator')).toContainText('kept on this device');

    // Thinking better of it keeps everything
    let asked = '';
    page.once('dialog', (d) => {
      asked = d.message();
      void d.dismiss();
    });
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect.poll(() => asked).toContain('1 change on this device hasn’t been saved yet');
    await expect(page.getByTestId('offline-indicator')).toContainText('kept on this device');

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to MavisDraw' })).toBeVisible();

    // Signing in again later: the discarded edit doesn't come back
    await context.setOffline(false);
    await signInAs(context, user);
    await page.goto(`/p/${project.id}`);
    await isConnected(page);
    await expect(recovered(page)).toHaveCount(0);
    expect(await getActiveElements(page)).toEqual([]);
    await context.close();
  });

  test('edits on a level that fails to load are kept until it does', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await noUnloadEvents(page);
    const user = await registerUser(context, 'Nested User');
    const project = await apiCreateProject(context.request, user, `Nested ${Date.now()}`);
    await page.goto(`/p/${project.id}`);
    await isConnected(page);

    // A portal, and a box on the level inside it
    await page.keyboard.press('o');
    await dragOnCanvas(page, { x: 420, y: 300 }, { x: 560, y: 400 });
    const portal = (await getActiveElements(page)).find((e) => e.type === 'portal')!;
    const inner = portal.targetDiagramId as string;
    const pc = await screenCenterOf(page, portal);
    await page.mouse.dblclick(pc.x, pc.y);
    await expect(page).toHaveURL(new RegExp(`/d/${inner}$`));
    await isConnected(page);
    await page.keyboard.press('r');
    await dragOnCanvas(page, { x: 150, y: 150 }, { x: 300, y: 250 });
    const innerBoxes = async () =>
      ((await apiGetDiagram(context.request, user, inner)).diagram?.elements ?? []).filter(
        (e) => e.type === 'rectangle',
      );
    await expect.poll(async () => (await innerBoxes()).length, { timeout: 20_000 }).toBe(1);
    const [box] = await getActiveElements(page);

    // Offline, the box is moved; then the tab dies
    await goOffline(context, page);
    const c = await screenCenterOf(page, box);
    await dragPage(page, c, { x: c.x + 200, y: c.y });
    await expect(page.getByTestId('offline-indicator')).toContainText('kept on this device');
    await killTab(page);

    // Reopened, but that level won't load right now
    await context.setOffline(false);
    const again = await context.newPage();
    const failInner = (route: import('@playwright/test').Route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 500, json: { error: 'Temporarily unavailable' } })
        : route.fallback();
    await again.route(`**/api/diagrams/${inner}`, failInner);
    await again.goto(`/p/${project.id}`);
    await expect(recovered(again, 'kept on this device until its level loads')).toBeVisible({
      timeout: 15_000,
    });
    await expect(recovered(again, 'skipped')).toHaveCount(0);

    // It loads once it's back: the move is applied and saved
    await again.unroute(`**/api/diagrams/${inner}`, failInner);
    const portalAgain = (await getActiveElements(again)).find((e) => e.type === 'portal')!;
    const p2 = await screenCenterOf(again, portalAgain);
    await again.mouse.dblclick(p2.x, p2.y);
    await expect(again).toHaveURL(new RegExp(`/d/${inner}$`));
    await expect(recovered(again, 'Recovered 1 unsaved change')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => (await getActiveElements(again)).find((e) => e.type === 'rectangle')?.x)
      .toBeGreaterThan((box.x as number) + 100);
    await expect
      .poll(async () => (await innerBoxes())[0]?.x as number, { timeout: 20_000 })
      .toBeGreaterThan((box.x as number) + 100);
    await context.close();
  });

  test('a nested diagram made offline comes back with what was drawn in it', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await noUnloadEvents(page);
    const user = await registerUser(context, 'Offline Nester');
    const project = await apiCreateProject(context.request, user, `Offline nest ${Date.now()}`);
    await page.goto(`/p/${project.id}`);
    await isConnected(page);

    // Offline: a portal, and a box on the new level inside it
    await goOffline(context, page);
    await page.keyboard.press('o');
    await dragOnCanvas(page, { x: 420, y: 300 }, { x: 560, y: 400 });
    const portal = (await getActiveElements(page)).find((e) => e.type === 'portal')!;
    const inner = portal.targetDiagramId as string;
    const pc = await screenCenterOf(page, portal);
    await page.mouse.dblclick(pc.x, pc.y);
    await expect(page).toHaveURL(new RegExp(`/d/${inner}$`));
    await page.keyboard.press('r');
    await dragOnCanvas(page, { x: 150, y: 150 }, { x: 300, y: 250 });
    await expect(page.getByTestId('offline-indicator')).toContainText('kept on this device');
    await killTab(page);

    // Back online: the level is recreated, and the box saved into it
    await context.setOffline(false);
    const again = await context.newPage();
    await again.goto(`/p/${project.id}`);
    await isConnected(again);
    await expect
      .poll(
        async () =>
          (await apiListDiagrams(context.request, user, project.id)).some((d) => d.id === inner),
        { timeout: 20_000 },
      )
      .toBe(true);
    await expect
      .poll(
        async () =>
          ((await apiGetDiagram(context.request, user, inner)).diagram?.elements ?? []).filter(
            (e) => e.type === 'rectangle' && !e.isDeleted,
          ).length,
        { timeout: 20_000 },
      )
      .toBe(1);
    const portalAgain = (await getActiveElements(again)).find((e) => e.type === 'portal')!;
    expect(portalAgain.targetDiagramId).toBe(inner);
    const p2 = await screenCenterOf(again, portalAgain);
    await again.mouse.dblclick(p2.x, p2.y);
    await expect(again).toHaveURL(new RegExp(`/d/${inner}$`));
    await expect
      .poll(
        async () => (await getActiveElements(again)).filter((e) => e.type === 'rectangle').length,
      )
      .toBe(1);
    await context.close();
  });
});

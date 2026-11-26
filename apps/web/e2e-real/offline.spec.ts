import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
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

/** Lose the network: no HTTP, and the live socket drops too. */
async function goOffline(context: BrowserContext, page: Page) {
  await page.evaluate(async () => {
    const m = await import('/src/stores/collaborationStore.ts');
    const provider = m.useCollaborationStore.getState().provider as unknown as {
      configuration: { websocketProvider: { disconnect: () => void } };
    } | null;
    provider?.configuration.websocketProvider.disconnect();
  });
  await context.setOffline(true);
}

test.describe('Offline', () => {
  test('edits made offline survive closing the tab, and save once back online', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
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
    // Then the tab is killed outright (no unload events, like a crash)
    await page.close();

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
});

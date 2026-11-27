import { test, expect } from '@playwright/test';
import {
  apiGetDiagram,
  dragOnCanvas,
  dragPage,
  getActiveElements,
  interactiveCanvas,
  liveBarrier,
  screenCenterOf,
  twoPeople,
  types,
} from './helpers';

test.describe('Teams', () => {
  test('a share link opens the project, and the URL deep-links the diagram', async ({
    browser,
  }) => {
    const { ctxA, ctxB, b, project } = await twoPeople(browser, 'editor');
    await expect(b).toHaveURL(new RegExp(`/p/${project.id}$`));
    await expect(b.getByTestId('view-only-badge')).toHaveCount(0);

    // Draw a portal, drill in: the address bar follows and survives a reload
    await b.keyboard.press('o');
    await dragOnCanvas(b, { x: 200, y: 160 }, { x: 420, y: 300 });
    const [portal] = await getActiveElements(b);
    const center = await screenCenterOf(b, portal);
    await b.mouse.dblclick(center.x, center.y);
    await expect(b).toHaveURL(new RegExp(`/p/${project.id}/d/${portal.targetDiagramId}$`));
    await b.reload();
    await expect
      .poll(() =>
        b.evaluate(() =>
          (
            window as unknown as { __MAVISDRAW__?: { getActiveDiagramId: () => string } }
          ).__MAVISDRAW__?.getActiveDiagramId(),
        ),
      )
      .toBe(portal.targetDiagramId);

    await ctxA.close();
    await ctxB.close();
  });

  test('undo only undoes your own work, and nothing is lost on the server', async ({ browser }) => {
    const { ctxA, ctxB, a, b, owner, project } = await twoPeople(browser, 'editor');

    await a.keyboard.press('r');
    await dragOnCanvas(a, { x: 150, y: 150 }, { x: 300, y: 250 });
    await b.keyboard.press('e');
    await dragOnCanvas(b, { x: 400, y: 150 }, { x: 520, y: 250 });
    await expect.poll(() => types(a)).toEqual(['ellipse', 'rectangle']);
    await expect.poll(() => types(b)).toEqual(['ellipse', 'rectangle']);

    // Alice undoes: her rectangle goes, Bob's ellipse stays — for both of them
    await a.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect.poll(() => types(a)).toEqual(['ellipse']);
    await expect.poll(() => types(b)).toEqual(['ellipse']);

    // Both people's work reaches the database (no last-writer-wins clobbering)
    await b.keyboard.press('d');
    await dragOnCanvas(b, { x: 150, y: 350 }, { x: 260, y: 450 });
    await expect
      .poll(
        async () =>
          (
            (await apiGetDiagram(ctxA.request, owner, project.rootDiagramId)).diagram?.elements ??
            []
          )
            .map((e) => e.type as string)
            .sort(),
        { timeout: 20_000 },
      )
      .toEqual(['diamond', 'ellipse']);

    await ctxA.close();
    await ctxB.close();
  });

  test("undo never reverts a teammate's later change to the same shape", async ({ browser }) => {
    const { ctxA, ctxB, a, b } = await twoPeople(browser, 'editor');
    const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

    // Alice draws a box and drags it sideways
    await a.keyboard.press('r');
    await dragOnCanvas(a, { x: 150, y: 150 }, { x: 300, y: 250 });
    await expect.poll(async () => (await getActiveElements(b)).length).toBe(1);
    const [drawn] = await getActiveElements(a);
    let c = await screenCenterOf(a, drawn);
    await dragPage(a, c, { x: c.x + 100, y: c.y });
    await expect.poll(async () => (await getActiveElements(a))[0].x).toBeGreaterThan(drawn.x + 50);
    const aliceX = (await getActiveElements(a))[0].x;
    await expect.poll(async () => (await getActiveElements(b))[0].x).toBe(aliceX);

    // Then Bob drags the same box down
    const [seen] = await getActiveElements(b);
    c = await screenCenterOf(b, seen);
    await dragPage(b, c, { x: c.x, y: c.y + 150 });
    await expect.poll(async () => (await getActiveElements(b))[0].y).toBeGreaterThan(drawn.y + 50);
    const bobY = (await getActiveElements(b))[0].y;
    await expect.poll(async () => (await getActiveElements(a))[0].y).toBe(bobY);

    // Alice undoes her drag: her sideways move is reverted, but the box stays
    // at the height Bob put it — on both screens
    await a.keyboard.press('Escape');
    await a.keyboard.press(undo);
    for (const page of [a, b]) {
      await expect.poll(async () => (await getActiveElements(page))[0]?.x).toBe(drawn.x);
      expect((await getActiveElements(page))[0].y).toBe(bobY);
    }

    await ctxA.close();
    await ctxB.close();
  });

  test('viewers watch live but cannot change anything', async ({ browser }) => {
    const { ctxA, ctxB, a, b } = await twoPeople(browser, 'viewer');

    await expect(b.getByTestId('view-only-badge')).toBeVisible();
    // Only navigation tools
    const toolbar = b.getByTestId('toolbar');
    await expect(toolbar.locator('button[title^="Select"]')).toBeVisible();
    await expect(toolbar.locator('button[title^="Hand"]')).toBeVisible();
    for (const tool of ['Rectangle', 'Ellipse', 'Arrow', 'Text', 'Portal']) {
      await expect(toolbar.locator(`button[title^="${tool}"]`)).toHaveCount(0);
    }
    await expect(b.getByRole('button', { name: 'Share' })).toHaveCount(0);

    // The owner draws; the viewer sees it live
    await a.keyboard.press('r');
    await dragOnCanvas(a, { x: 150, y: 150 }, { x: 300, y: 250 });
    await expect.poll(() => types(b)).toEqual(['rectangle']);

    // The viewer tries to draw, drag and delete: nothing changes anywhere
    await b.keyboard.press('r');
    await dragOnCanvas(b, { x: 400, y: 300 }, { x: 500, y: 380 });
    const [rect] = await getActiveElements(b);
    const c = await screenCenterOf(b, rect);
    const box = (await interactiveCanvas(b).boundingBox())!;
    await b.mouse.move(c.x, c.y);
    await b.mouse.down();
    await b.mouse.move(c.x + 120, c.y + 80, { steps: 5 });
    await b.mouse.up();
    await b.keyboard.press('Delete');
    expect(box).toBeTruthy();
    // Anything the viewer's tab sent has been through the server by now
    await liveBarrier(b, a);
    expect(await types(b)).toEqual(['rectangle']);
    expect(await types(a)).toEqual(['rectangle']);
    expect((await getActiveElements(a))[0].x).toBe(rect.x);

    await ctxA.close();
    await ctxB.close();
  });

  test('version history is shared and restoring updates everyone live', async ({ browser }) => {
    const { ctxA, ctxB, a, b } = await twoPeople(browser, 'editor');

    await a.keyboard.press('r');
    await dragOnCanvas(a, { x: 150, y: 150 }, { x: 300, y: 250 });
    await expect.poll(() => types(b)).toEqual(['rectangle']);

    // Alice saves a named version
    await a.getByRole('button', { name: 'History' }).click();
    await a.getByPlaceholder('Version label...').fill('Before the redesign');
    await a.getByPlaceholder('Version label...').press('Enter');
    await expect(a.getByTestId('version-history').getByText('Before the redesign')).toBeVisible();

    // Bob sees it in his history
    await b.getByRole('button', { name: 'History' }).click();
    await expect(b.getByTestId('version-history').getByText('Before the redesign')).toBeVisible();

    // Alice keeps editing (focus is still in the label field, so she picks
    // the tool from the toolbar); Bob restores the version; Alice's canvas follows
    await a.getByTestId('toolbar').locator('button[title^="Ellipse"]').click();
    await dragOnCanvas(a, { x: 400, y: 150 }, { x: 520, y: 250 });
    await expect.poll(() => types(b)).toEqual(['ellipse', 'rectangle']);
    b.once('dialog', (d) => d.accept());
    const entry = b
      .getByTestId('version-history')
      .getByTestId('version-entry')
      .filter({ hasText: 'Before the redesign' });
    await entry.hover();
    await entry.getByRole('button', { name: 'Restore' }).click();
    await expect.poll(() => types(a)).toEqual(['rectangle']);
    await expect.poll(() => types(b)).toEqual(['rectangle']);

    await ctxA.close();
    await ctxB.close();
  });
});

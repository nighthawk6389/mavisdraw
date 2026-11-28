import { test, expect, type Page } from '@playwright/test';
import {
  registerUser,
  apiCreateProject,
  apiGetDiagram,
  apiListDiagrams,
  openProject,
  dragOnCanvas,
  getActiveElements,
  interactiveCanvas,
  waitForSaved,
  screenCenterOf,
} from './helpers';

async function activeDiagramId(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (window as unknown as { __MAVISDRAW__: { getActiveDiagramId: () => string } }).__MAVISDRAW__.getActiveDiagramId(),
  );
}

test.describe('Nested diagrams persist', () => {
  test('content drawn inside a portal survives a reload', async ({ page, context }) => {
    const user = await registerUser(context, 'Architect');
    const project = await apiCreateProject(context.request, user, 'Checkout Platform');
    await openProject(page, 'Checkout Platform');
    const rootId = await activeDiagramId(page);
    expect(rootId).toBe(project.rootDiagramId);

    // Draw a portal: it creates a nested diagram
    await page.keyboard.press('o');
    await dragOnCanvas(page, { x: 200, y: 160 }, { x: 420, y: 300 });
    await expect.poll(async () => (await getActiveElements(page)).map((e) => e.type)).toEqual([
      'portal',
    ]);
    const [portal] = await getActiveElements(page);
    const childId = portal.targetDiagramId as string;
    expect(childId).toBeTruthy();

    // The child diagram exists on the server right away
    await expect
      .poll(async () => (await apiListDiagrams(context.request, user, project.id)).map((d) => d.id))
      .toContain(childId);

    // Drill in and draw a labelled shape
    const box = (await interactiveCanvas(page).boundingBox())!;
    await page.mouse.dblclick(box.x + 310, box.y + 230);
    await expect.poll(() => activeDiagramId(page)).toBe(childId);
    await page.keyboard.press('r');
    await dragOnCanvas(page, { x: 300, y: 250 }, { x: 460, y: 340 });
    await page.mouse.dblclick(box.x + 380, box.y + 295);
    await page.keyboard.type('Payments DB');
    await page.keyboard.press('Escape');
    await waitForSaved(page);

    // The server has the child's contents
    await expect
      .poll(async () => {
        const res = await apiGetDiagram(context.request, user, childId);
        return (res.diagram?.elements ?? []).map((e) => e.type).sort();
      })
      .toEqual(['rectangle', 'text']);

    // Reload and drill back in (the editor frames the content on open)
    await page.reload();
    await openProject(page, 'Checkout Platform');
    await expect.poll(async () => (await getActiveElements(page)).length).toBe(1);
    const [reloadedPortal] = await getActiveElements(page);
    const center = await screenCenterOf(page, reloadedPortal);
    await page.mouse.dblclick(center.x, center.y);
    await expect.poll(() => activeDiagramId(page)).toBe(childId);
    await expect
      .poll(async () =>
        (await getActiveElements(page))
          .filter((e) => e.type === 'text')
          .map((e) => e.text),
      )
      .toEqual(['Payments DB']);
  });

  test('edits made just before navigating up are not lost', async ({ page, context }) => {
    const user = await registerUser(context, 'Fast Navigator');
    await apiCreateProject(context.request, user, 'Edge Cases');
    await openProject(page, 'Edge Cases');

    await page.keyboard.press('o');
    await dragOnCanvas(page, { x: 200, y: 160 }, { x: 420, y: 300 });
    const [portal] = await getActiveElements(page);
    const childId = portal.targetDiagramId as string;
    const box = (await interactiveCanvas(page).boundingBox())!;
    await page.mouse.dblclick(box.x + 310, box.y + 230);
    await expect.poll(() => activeDiagramId(page)).toBe(childId);

    // Draw and leave immediately, well inside the autosave debounce
    await page.keyboard.press('e');
    await dragOnCanvas(page, { x: 300, y: 250 }, { x: 400, y: 320 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace'); // navigate up
    await expect.poll(() => activeDiagramId(page)).not.toBe(childId);

    await expect
      .poll(async () => {
        const res = await apiGetDiagram(context.request, user, childId);
        return (res.diagram?.elements ?? []).map((e) => e.type);
      })
      .toEqual(['ellipse']);
  });

  test('a pasted Mermaid map, with its nested levels, is saved to the server', async ({
    page,
    context,
  }) => {
    const user = await registerUser(context, 'Mermaid Fan');
    const project = await apiCreateProject(context.request, user, 'From README');
    await openProject(page, 'From README');

    const box = (await interactiveCanvas(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData(
        'text/plain',
        [
          'flowchart LR',
          '  client[Mobile App] -->|HTTPS| gw',
          '  subgraph platform [Platform]',
          '    gw[Gateway] --> svc[Orders]',
          '    subgraph storage [Storage]',
          '      db[(Postgres)]',
          '    end',
          '    svc --> db',
          '  end',
        ].join('\n'),
      );
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    });
    await expect(page.getByTestId('toast')).toContainText('2 nested diagrams');
    await waitForSaved(page);

    // Server: root → Platform → Storage, each with its own contents
    const diagrams = await apiListDiagrams(context.request, user, project.id);
    const platform = diagrams.find((d) => d.title === 'Platform')!;
    const storage = diagrams.find((d) => d.title === 'Storage')!;
    expect(platform.parentDiagramId).toBe(project.rootDiagramId);
    expect(storage.parentDiagramId).toBe(platform.id);

    const texts = async (id: string) =>
      ((await apiGetDiagram(context.request, user, id)).diagram?.elements ?? [])
        .filter((e) => e.type === 'text')
        .map((e) => e.text as string)
        .sort();
    await expect.poll(() => texts(project.rootDiagramId)).toEqual(['HTTPS', 'Mobile App']);
    await expect.poll(() => texts(platform.id)).toEqual(['Gateway', 'Orders']);
    await expect.poll(() => texts(storage.id)).toEqual(['Postgres']);
  });
});

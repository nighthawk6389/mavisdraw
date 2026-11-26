import { test, expect, type Page } from '@playwright/test';
import { interactiveCanvas, twoPeople } from './helpers';

const activeDiagram = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __MAVISDRAW__?: { getActiveDiagramId: () => string } }
    ).__MAVISDRAW__?.getActiveDiagramId(),
  );

async function pasteMermaid(page: Page, text: string) {
  const box = (await interactiveCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate((t) => {
    const data = new DataTransfer();
    data.setData('text/plain', t);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, text);
}

test('one click turns the map into a guided tour, and the audience follows across levels', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b } = await twoPeople(browser, 'viewer', {
    owner: 'Olivia Owner',
    guest: 'Victor Viewer',
  });

  await pasteMermaid(
    a,
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
  await expect(a.getByTestId('toast').filter({ hasText: '2 nested diagrams' })).toBeVisible();
  const root = await activeDiagram(a);

  // Olivia generates a tour: one stop per level, top-down, with what's on each
  await a.getByRole('button', { name: 'Present', exact: true }).click();
  await a.getByRole('button', { name: 'Generate from map' }).click();
  const stops = a.getByTestId('tour-stop');
  await expect(stops).toHaveCount(3);
  await expect(stops.nth(0).getByRole('textbox', { name: 'Stop 1 title' })).toHaveValue(/overview/);
  await expect(stops.nth(1).getByRole('textbox', { name: 'Stop 2 title' })).toHaveValue('Platform');
  await expect(stops.nth(2).getByRole('textbox', { name: 'Stop 3 title' })).toHaveValue('Storage');
  await expect(stops.nth(0).getByRole('textbox', { name: 'Stop 1 note' })).toHaveValue(
    /Mobile App.*— Zooms into: Platform/,
  );
  await stops
    .nth(1)
    .getByRole('textbox', { name: 'Stop 2 note' })
    .fill('Everything behind the gateway.');

  // She presents: the editor's chrome disappears, the card shows the stop
  await a.getByRole('button', { name: '▶ Present' }).click();
  await expect(a.getByTestId('presentation-title')).toContainText('overview');
  await expect(a.getByRole('button', { name: 'Share' })).toBeHidden();

  // Victor is invited to follow, and does
  await expect(b.getByTestId('presenter-banner')).toContainText('Olivia Owner is presenting');
  await b.getByTestId('presenter-banner').getByRole('button', { name: 'Follow' }).click();
  await expect(b.getByTestId('presentation')).toContainText('Following Olivia Owner');

  // → drills Olivia into Platform, and Victor with her
  await a.keyboard.press('ArrowRight');
  await expect(a.getByTestId('presentation-title')).toHaveText('Platform');
  await expect(a.getByTestId('presentation-note')).toHaveText('Everything behind the gateway.');
  await expect.poll(() => activeDiagram(a)).not.toBe(root);
  const platform = await activeDiagram(a);
  await expect.poll(() => activeDiagram(b), { timeout: 10_000 }).toBe(platform);
  await expect(b.getByTestId('presentation-title')).toHaveText('Platform');

  // …one level deeper, then back
  await a.keyboard.press('ArrowRight');
  await expect(a.getByTestId('presentation-title')).toHaveText('Storage');
  await expect(b.getByTestId('presentation-title')).toHaveText('Storage', { timeout: 10_000 });
  await a.keyboard.press('ArrowLeft');
  await expect.poll(() => activeDiagram(b), { timeout: 10_000 }).toBe(platform);

  // Keys don't edit the diagram while presenting
  await a.keyboard.press('r');
  await expect(a.getByTestId('presentation')).toBeVisible();

  // Escape ends it for everyone; the editor comes back
  await a.keyboard.press('Escape');
  await expect(a.getByRole('button', { name: 'Share' })).toBeVisible();
  await expect(b.getByTestId('presentation')).toHaveCount(0, { timeout: 10_000 });
  await expect(b.getByTestId('presenter-banner')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

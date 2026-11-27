import { test, expect, type Page } from '@playwright/test';
import {
  API_URL,
  apiCreateProject,
  apiListDiagrams,
  interactiveCanvas,
  openProject,
  registerUser,
  twoPeople,
  waitForSaved,
} from './helpers';

async function pasteMermaid(page: Page, lines: string[]) {
  const box = (await interactiveCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, lines.join('\n'));
}

/** The snippet shown for a tab of the Share dialog's embed section. */
async function snippet(page: Page, tab: 'Website / docs' | 'GitHub README' | 'Link') {
  const section = page.getByTestId('embed-section');
  await section.getByRole('tab', { name: tab }).click();
  return (await section.getByTestId('embed-snippet').textContent())!.trim();
}

test.describe('Embeds', () => {
  test('a published map is viewable anywhere, stays current, and can be withdrawn', async ({
    page,
    context,
    browser,
  }) => {
    const user = await registerUser(context, 'Embed Owner');
    const project = await apiCreateProject(context.request, user, 'Embed Demo');
    await openProject(page, 'Embed Demo');
    await pasteMermaid(page, [
      'flowchart LR',
      '  web[Web App] -->|HTTPS| api',
      '  subgraph platform [Platform]',
      '    api[API] --> db[(Orders DB)]',
      '  end',
    ]);
    await waitForSaved(page);
    await expect
      .poll(async () =>
        (await apiListDiagrams(context.request, user, project.id)).map((d) => d.title).sort(),
      )
      .toContain('Platform');

    // Publish from the Share dialog
    await page.getByRole('button', { name: 'Share' }).click();
    await page.getByRole('button', { name: 'Publish an embed' }).click();
    const section = page.getByTestId('embed-section');
    await expect(section).toContainText('anyone with the link can view');
    const viewerUrl = await snippet(page, 'Link');
    const readme = await snippet(page, 'GitHub README');
    const iframe = await snippet(page, 'Website / docs');
    const imageUrl = /src="([^"]+\/svg)"/.exec(readme)![1];
    expect(viewerUrl).toMatch(/\/embed\.html\?t=[\w-]+$/);
    expect(iframe).toContain(`src="${viewerUrl}"`);
    expect(imageUrl.startsWith(`${API_URL}/api/embed/`)).toBe(true);

    // The README image: the real diagram, safe to open, cacheable
    const anon = await browser.newContext();
    const svg = await anon.request.get(imageUrl);
    expect(svg.status()).toBe(200);
    expect(svg.headers()['content-type']).toContain('image/svg+xml');
    expect(svg.headers()['content-security-policy']).toContain("default-src 'none'");
    expect(svg.headers()['x-content-type-options']).toBe('nosniff');
    const body = await svg.text();
    for (const label of ['Web App', 'Platform', 'HTTPS']) expect(body).toContain(label);
    expect(body).not.toContain('Orders DB'); // nested inside Platform
    const again = await anon.request.get(imageUrl, {
      headers: { 'If-None-Match': svg.headers()['etag'] },
    });
    expect(again.status()).toBe(304);
    expect(await (await anon.request.get(`${imageUrl}?theme=dark`)).text()).toContain('#0d1117');

    // The interactive viewer, inside an iframe on someone else's page, signed out
    const reader = await anon.newPage();
    await reader.setContent(`<h1>Our docs</h1>${iframe.replace('height="480"', 'height="520"')}`, {
      waitUntil: 'load',
    });
    const frame = reader.frameLocator('iframe');
    await expect(frame.locator('svg text', { hasText: 'Web App' })).toBeVisible();
    await expect(frame.getByRole('navigation')).toContainText('Embed Demo');
    // Look inside Platform
    await frame.locator('g.portal[data-label="Platform"]').click();
    await expect(frame.getByRole('navigation')).toContainText('Platform');
    await expect(frame.locator('svg text', { hasText: 'Orders DB' })).toBeVisible();
    await expect(frame.locator('svg text', { hasText: 'Web App' })).toHaveCount(0);
    // …and back up
    await frame.getByRole('navigation').getByRole('button', { name: 'Embed Demo' }).click();
    await expect(frame.locator('svg text', { hasText: 'Web App' })).toBeVisible();
    await expect(frame.getByRole('link', { name: 'Open in MavisDraw' })).toHaveAttribute(
      'href',
      new RegExp(`/p/${project.id}$`),
    );

    // The map changes: the image follows
    await page.getByRole('button', { name: 'Done' }).click();
    await pasteMermaid(page, ['flowchart LR', '  cache[(Redis)]']);
    await waitForSaved(page);
    await expect.poll(async () => (await anon.request.get(imageUrl)).text()).toContain('Redis');
    // …and a copy cached before the change is no longer confirmed as current
    const stale = await anon.request.get(imageUrl, {
      headers: { 'If-None-Match': svg.headers()['etag'] },
    });
    expect(stale.status()).toBe(200);

    // A new link breaks the old one
    await page.getByRole('button', { name: 'Share' }).click();
    await page.getByTestId('embed-section').getByRole('button', { name: 'New link' }).click();
    await expect.poll(async () => (await anon.request.get(imageUrl)).status()).toBe(404);
    const newViewerUrl = await snippet(page, 'Link');
    expect(newViewerUrl).not.toBe(viewerUrl);

    // Unpublishing withdraws it everywhere
    await page.getByTestId('embed-section').getByRole('button', { name: 'Unpublish' }).click();
    await expect(page.getByRole('button', { name: 'Publish an embed' })).toBeVisible();
    await reader.goto(newViewerUrl);
    await expect(reader.getByRole('status')).toContainText('This embed is no longer available');

    await anon.close();
  });

  test('only owners and admins can publish', async ({ browser }) => {
    const { ctxA, ctxB, guest, project } = await twoPeople(browser, 'editor');
    const res = await ctxB.request.post(`${API_URL}/api/projects/${project.id}/embed`, {
      headers: { Authorization: `Bearer ${guest.accessToken}` },
      data: {},
    });
    expect(res.status()).toBe(403);
    const unknown = await ctxB.request.get(`${API_URL}/api/embed/not-a-real-token-at-all/svg`);
    expect(unknown.status()).toBe(404);
    await ctxA.close();
    await ctxB.close();
  });
  test('trying again after a failed load doesn’t pile up refreshes', async ({ browser }) => {
    const ctx = await browser.newContext();
    const user = await registerUser(ctx, 'Embed Retry');
    const project = await apiCreateProject(ctx.request, user, `Retry ${Date.now()}`);
    const published = await ctx.request.post(`${API_URL}/api/projects/${project.id}/embed`, {
      headers: { Authorization: `Bearer ${user.accessToken}` },
      data: {},
    });
    const { embed } = (await published.json()) as { embed: { token: string } };

    const viewer = await browser.newContext();
    const page = await viewer.newPage();
    await page.clock.install();
    // The diagram fails to load twice, so the reader tries again twice
    let failures = 2;
    let diagramRequests = 0;
    await page.route(`**/api/embed/${embed.token}/diagrams/**`, (route) => {
      diagramRequests++;
      return failures-- > 0 ? route.fulfill({ status: 503, body: 'busy' }) : route.fallback();
    });
    await page.goto(`/embed.html?t=${embed.token}`);
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Try again' }).click();
    }
    await expect(page.getByRole('button', { name: 'Fit to view' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);

    // One refresh a minute, not one per attempt
    const loaded = diagramRequests;
    await page.clock.runFor(61_000);
    await expect.poll(() => diagramRequests - loaded).toBe(1);
    await page.clock.runFor(61_000);
    await expect.poll(() => diagramRequests - loaded).toBe(2);
    await ctx.close();
    await viewer.close();
  });
});

import { test, expect } from '@playwright/test';
import { SINGLE_SITE_URL as SITE } from './helpers';

/**
 * The Render deployment: the API serves the built app on its own address
 * (WEB_DIST, with only Render's RENDER_EXTERNAL_URL to say what that is), so
 * the session cookie is first-party and each page has its own framing rule.
 * The rest of the suite runs the app from Vite on a port of its own.
 */

test.describe('One address for the app and the API', () => {
  test('sign in, reload and stay signed in; the editor goes live on the same address', async ({
    page,
    playwright,
  }) => {
    const email = `single-${Date.now()}@e2e.mavisdraw.dev`;
    const password = 'correct-horse-battery';
    const api = await playwright.request.newContext({ baseURL: SITE });
    expect(
      (await api.post('/api/auth/register', { data: { email, password, name: 'Solo' } })).status(),
    ).toBe(201);

    // Everything the page asks for stays on this address
    const elsewhere: string[] = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.protocol.startsWith('http') && url.origin !== SITE) elsewhere.push(r.url());
    });

    // The emailed link is on this address too, and opens the app's own page
    let link = '';
    await expect
      .poll(async () => {
        const { messages } = (await (await api.get('/api/test/outbox')).json()) as {
          messages: Array<{ to: string; text: string }>;
        };
        link = /https?:\/\/\S+/.exec(messages.find((m) => m.to === email)?.text ?? '')?.[0] ?? '';
        return link;
      })
      .toMatch(new RegExp(`^${SITE}/verify-email\\?token=`));
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Your email is confirmed' })).toBeVisible();

    await page.goto(`${SITE}/`);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

    // The session cookie came back with the app's own requests
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

    await page.getByRole('button', { name: 'New Project' }).click();
    await page.getByPlaceholder('Project name').fill('One Site');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    // Every socket the editor opens is on this address, and none is left
    // open unused (each is either live or closed)
    const sockets: Array<{ url: string; received: number; closed: boolean }> = [];
    page.on('websocket', (ws) => {
      const socket = { url: ws.url(), received: 0, closed: false };
      sockets.push(socket);
      ws.on('framereceived', () => (socket.received += 1));
      ws.on('close', () => (socket.closed = true));
    });
    await page.getByText('One Site', { exact: true }).click();
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect.poll(() => sockets.some((ws) => ws.received > 0)).toBe(true);
    expect(sockets.map((ws) => ws.url)).toEqual(
      sockets.map(() => `${SITE.replace(/^http/, 'ws')}/collaboration`),
    );
    await expect.poll(() => sockets.filter((ws) => !ws.closed && ws.received === 0)).toEqual([]);

    // An app address opened directly (a shared link) is the app, not a 404
    await page.goto(page.url());
    await expect(page.locator('canvas').first()).toBeVisible();
    expect(elsewhere).toEqual([]);
    await api.dispose();
  });

  test('other sites can frame the embed viewer, not the app', async ({ page, request }) => {
    const app = await request.get(`${SITE}/p/anything`);
    expect(app.status()).toBe(200);
    expect(app.headers()['x-frame-options']).toBe('SAMEORIGIN');
    expect(app.headers()['content-security-policy']).toBe("frame-ancestors 'self'");
    const embed = await request.get(`${SITE}/embed.html`);
    expect(embed.headers()['x-frame-options']).toBeUndefined();
    // A missing build file is a plain 404, and the API is still the API
    expect((await request.get(`${SITE}/assets/gone-123.js`)).status()).toBe(404);
    expect((await request.get(`${SITE}/api/nope`)).status()).toBe(404);
    expect(await (await request.get(`${SITE}/api/health`)).json()).toMatchObject({ status: 'ok' });

    // A page on another address puts both in frames: only the embed viewer shows
    const blocked: string[] = [];
    page.on('requestfailed', (r) => {
      if (r.failure()?.errorText === 'net::ERR_BLOCKED_BY_RESPONSE') blocked.push(r.url());
    });
    await page.goto('/');
    await page.evaluate((site) => {
      document.body.innerHTML = `<iframe name="app" src="${site}/"></iframe><iframe name="embed" src="${site}/embed.html"></iframe>`;
    }, SITE);
    const frameUrl = async (name: string) =>
      (await (await page.$(`iframe[name="${name}"]`))?.contentFrame())?.url();
    await expect.poll(() => frameUrl('embed')).toBe(`${SITE}/embed.html`);
    await expect.poll(() => blocked).toEqual([`${SITE}/`]);
    expect(await frameUrl('app')).not.toBe(`${SITE}/`);
  });
});

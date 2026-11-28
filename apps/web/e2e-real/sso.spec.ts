import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, apiCreateProject, registerUser } from './helpers';

/**
 * Single sign-on against a stand-in OpenID Connect provider (fake-github.mjs,
 * /oidc): the server runs with OIDC_* set, allowing acme.example addresses.
 */

const IDP = `http://localhost:${process.env.E2E_GITHUB_PORT ?? '3102'}`;
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Who the provider signs in next. */
async function nextSignIn(
  request: APIRequestContext,
  user: { sub?: string; email?: string; name?: string; email_verified?: boolean; deny?: boolean },
) {
  const res = await request.post(`${IDP}/__test/oidc-user`, { data: user });
  expect(res.ok()).toBe(true);
}

test.describe('Single sign-on', () => {
  test('someone new signs in with the provider and gets an account, confirmed', async ({
    page,
  }) => {
    const email = `ana-${uniq()}@acme.example`;
    await nextSignIn(page.request, { sub: `okta-${uniq()}`, email, name: 'Ana Acme' });
    await page.goto('/');
    await page.getByTestId('sso-button').click();
    // Through the provider and back, signed in
    await expect(page.getByText('Recent projects')).toBeVisible();
    await expect(page.getByText('Ana Acme')).toBeVisible();
    await expect(page.getByTestId('confirm-email-banner')).toHaveCount(0);
  });

  test('an existing account with the same address is the one signed into', async ({ browser }) => {
    const ctx = await browser.newContext();
    const email = `bo-${uniq()}@acme.example`;
    const user = await registerUser(ctx, 'Bo Builder', 'bo', { email });
    await apiCreateProject(ctx.request, user, 'Bo’s Map');
    await ctx.close();

    const fresh = await browser.newContext();
    const page = await fresh.newPage();
    const sub = `okta-${uniq()}`;
    await nextSignIn(page.request, { sub, email: email.toUpperCase(), name: 'Bo B.' });
    await page.goto('/');
    await page.getByTestId('sso-button').click();
    await expect(page.getByText('Bo’s Map')).toBeVisible();

    // Next time the provider's identity alone is enough (even with a new address there)
    const again = await browser.newContext();
    const p2 = await again.newPage();
    await nextSignIn(p2.request, {
      sub,
      email: `bo.renamed-${uniq()}@acme.example`,
      name: 'Bo B.',
    });
    await p2.goto('/');
    await p2.getByTestId('sso-button').click();
    await expect(p2.getByText('Bo’s Map')).toBeVisible();
    await fresh.close();
    await again.close();
  });

  test('an account someone registered with the address but never confirmed is taken back', async ({
    browser,
  }) => {
    const email = `cy-${uniq()}@acme.example`;
    const ctxM = await browser.newContext();
    const squatter = await registerUser(ctxM, 'Mallory', 'm', { email, verify: false });
    const auth = { Authorization: `Bearer ${squatter.accessToken}` };
    const made = await ctxM.request.post(`${API_URL}/api/tokens`, {
      headers: auth,
      data: { name: 'stash' },
    });
    const { token: agentToken } = (await made.json()) as { token: string };

    // The address's real owner signs in with the company's provider
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await nextSignIn(page.request, { sub: `okta-${uniq()}`, email, name: 'Cy Real' });
    await page.goto('/');
    await page.getByTestId('sso-button').click();
    await expect(page.getByText('Recent projects')).toBeVisible();
    await expect(page.getByTestId('confirm-email-banner')).toHaveCount(0);

    // Whoever registered it has no way back in: password, session, the access
    // token in hand, or the agent token
    const login = await ctxM.request.post(`${API_URL}/api/auth/login`, {
      data: { email, password: squatter.password },
    });
    expect(login.status()).not.toBe(200);
    const refreshed = await ctxM.request.post(`${API_URL}/api/auth/refresh`, { data: {} });
    expect(refreshed.status()).not.toBe(200);
    expect((await ctxM.request.get(`${API_URL}/api/projects`, { headers: auth })).status()).toBe(
      401,
    );
    const agent = await ctxM.request.post(`${API_URL}/api/mcp`, {
      headers: {
        Authorization: `Bearer ${agentToken}`,
        Accept: 'application/json, text/event-stream',
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(agent.status()).toBe(401);
    await ctxM.close();
    await ctx.close();
  });

  test('comes back to the invite it started from', async ({ browser }) => {
    const ctxO = await browser.newContext();
    const owner = await registerUser(ctxO, 'Olivia Owner');
    const name = `Shared ${uniq()}`;
    const project = await apiCreateProject(ctxO.request, owner, name);
    const email = `cy-${uniq()}@acme.example`;
    const res = await ctxO.request.post(`${API_URL}/api/projects/${project.id}/invites`, {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      data: { email, role: 'editor' },
    });
    const { inviteUrl } = (await res.json()) as { inviteUrl: string };

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await nextSignIn(page.request, { sub: `okta-${uniq()}`, email, name: 'Cy' });
    await page.goto(new URL(inviteUrl, 'http://x').pathname);
    await expect(page.getByTestId('invite-banner')).toContainText(name);
    await page.getByTestId('sso-button').click();
    // Signed in, the invite accepted, and the project open
    await expect(page).toHaveURL(new RegExp(`/p/${project.id}`), { timeout: 15_000 });
    await expect(page.locator('canvas').first()).toBeVisible();
    await ctxO.close();
    await ctx.close();
  });

  test('refuses addresses outside the allowed domains, and cancelled or forged sign-ins', async ({
    page,
  }) => {
    await nextSignIn(page.request, { sub: `g-${uniq()}`, email: `eve-${uniq()}@gmail.com` });
    await page.goto('/');
    await page.getByTestId('sso-button').click();
    await expect(page.getByTestId('sso-error')).toContainText('isn’t allowed to sign in here');
    await expect(page).toHaveURL(/\/$/); // the error code doesn't linger in the address

    await nextSignIn(page.request, { deny: true });
    await page.getByTestId('sso-button').click();
    await expect(page.getByTestId('sso-error')).toContainText('was cancelled');
    await nextSignIn(page.request, { deny: false });

    // A callback that this browser didn't start (no state cookie)
    await page.goto(`${API_URL}/api/auth/oidc/callback?code=stolen&state=whatever`);
    await expect(page.getByTestId('sso-error')).toContainText('didn’t start here');
    await expect(page.getByText('Recent projects')).toHaveCount(0);
  });

  test('the server says what it offers, and passwords still work alongside', async ({
    request,
  }) => {
    const res = await request.get(`${API_URL}/api/config`);
    expect(await res.json()).toMatchObject({ sso: { name: 'Acme SSO' }, passwordLogin: true });
  });
});

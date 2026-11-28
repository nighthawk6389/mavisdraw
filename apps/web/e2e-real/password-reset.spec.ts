import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, apiCreateProject, linkIn, registerUser, waitForEmail } from './helpers';

/**
 * Forgotten passwords, and taking back an address someone else registered:
 * the link proves the inbox is yours.
 */

const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'a-brand-new-passphrase';

const login = (request: APIRequestContext, email: string, password: string) =>
  request.post(`${API_URL}/api/auth/login`, { data: { email, password } });
const refresh = (request: APIRequestContext) =>
  request.post(`${API_URL}/api/auth/refresh`, { data: {} });
/** A coding agent's request with this token (200: it's let in). */
const mcpStatus = async (request: APIRequestContext, token: string) =>
  (
    await request.post(`${API_URL}/api/mcp`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    })
  ).status();

test.describe('Password reset', () => {
  test('a forgotten password is reset from the emailed link, and other sessions end', async ({
    browser,
  }) => {
    // Signed in on one device…
    const ctxA = await browser.newContext();
    const user = await registerUser(ctxA, 'Forgetful Fran');
    expect((await refresh(ctxA.request)).status()).toBe(200);

    // …and asking for a reset on another
    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    await b.goto('/');
    await b.getByRole('button', { name: 'Forgot your password?' }).click();
    await b.getByLabel('Email').fill(user.email);
    await b.getByRole('button', { name: 'Email me a reset link' }).click();
    await expect(b.getByTestId('forgot-password')).toContainText(
      `If there’s an account for ${user.email}`,
    );

    const sent = await waitForEmail(ctxB.request, user.email, /Reset your MavisDraw password/);
    const link = new URL(linkIn(sent));
    await b.goto(link.pathname + link.search);
    await expect(b).toHaveURL(/\/reset-password$/); // the token leaves the address bar
    await b.getByLabel('New password').fill(NEW_PASSWORD);
    await b.getByLabel('Confirm it').fill(NEW_PASSWORD);
    await b.getByRole('button', { name: 'Set password and sign in' }).click();

    // Signed in here, with the new password only
    await expect(b.getByText('Recent projects')).toBeVisible();
    await expect(b.getByTestId('toast').filter({ hasText: 'Password changed' })).toBeVisible();
    expect((await login(ctxB.request, user.email, PASSWORD)).status()).toBe(401);
    expect((await login(ctxB.request, user.email, NEW_PASSWORD)).status()).toBe(200);
    // The other device's session is over
    expect((await refresh(ctxA.request)).status()).not.toBe(200);

    // The link worked once
    const again = await browser.newContext();
    const c = await again.newPage();
    await c.goto(link.pathname + link.search);
    await c.getByLabel('New password').fill('yet-another-password');
    await c.getByLabel('Confirm it').fill('yet-another-password');
    await c.getByRole('button', { name: 'Set password and sign in' }).click();
    await expect(c.getByRole('alert')).toContainText('already used');

    await ctxA.close();
    await ctxB.close();
    await again.close();
  });

  test('the real owner of an address takes back an account someone else registered', async ({
    browser,
  }) => {
    const email = `cto-${uniq()}@example.com`;
    // Someone registers the CTO's address (and can't confirm it)…
    const ctxM = await browser.newContext();
    const squatter = await registerUser(ctxM, 'Mallory', 'm', { email, verify: false });
    // …makes an access token for a coding agent, to keep a way in…
    const made = await ctxM.request.post(`${API_URL}/api/tokens`, {
      headers: { Authorization: `Bearer ${squatter.accessToken}` },
      data: { name: 'stash' },
    });
    expect(made.status()).toBe(201);
    const { token: agentToken } = (await made.json()) as { token: string };
    expect(await mcpStatus(ctxM.request, agentToken)).toBe(200);
    // …and a project is shared with that address meanwhile
    const ctxO = await browser.newContext();
    const owner = await registerUser(ctxO, 'Olivia Owner');
    const name = `Board ${uniq()}`;
    const project = await apiCreateProject(ctxO.request, owner, name);
    await ctxO.request.post(`${API_URL}/api/projects/${project.id}/invites`, {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      data: { email, role: 'editor' },
    });

    // The CTO can't sign up ("already registered"), so resets the password
    const ctxV = await browser.newContext();
    const v = await ctxV.newPage();
    await ctxV.request.post(`${API_URL}/api/auth/forgot-password`, { data: { email } });
    const link = new URL(
      linkIn(await waitForEmail(ctxV.request, email, /Reset your MavisDraw password/)),
    );
    await v.goto(link.pathname + link.search);
    await v.getByLabel('New password').fill(NEW_PASSWORD);
    await v.getByLabel('Confirm it').fill(NEW_PASSWORD);
    await v.getByRole('button', { name: 'Set password and sign in' }).click();

    // The account is theirs: confirmed, with what was shared with the address
    await expect(v.getByText(name)).toBeVisible();
    await expect(v.getByTestId('confirm-email-banner')).toHaveCount(0);
    // …and the squatter is signed out, everywhere: session, the access token
    // already in hand, and the agent's token
    expect((await refresh(ctxM.request)).status()).not.toBe(200);
    const stillIn = await ctxM.request.get(`${API_URL}/api/projects`, {
      headers: { Authorization: `Bearer ${squatter.accessToken}` },
    });
    expect(stillIn.status()).toBe(401);
    expect(await mcpStatus(ctxM.request, agentToken)).toBe(401);

    await ctxM.close();
    await ctxO.close();
    await ctxV.close();
  });

  test('asking about an unknown address says the same, and sends nothing', async ({ page }) => {
    const email = `nobody-${uniq()}@example.com`;
    await page.goto('/');
    await page.getByRole('button', { name: 'Forgot your password?' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Email me a reset link' }).click();
    await expect(page.getByTestId('forgot-password')).toContainText(
      `If there’s an account for ${email}`,
    );
    const res = await page.request.get(`${API_URL}/api/test/outbox`);
    const { messages } = (await res.json()) as { messages: Array<{ to: string }> };
    expect(messages.some((m) => m.to === email)).toBe(false);
  });
});

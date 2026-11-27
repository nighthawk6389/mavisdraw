import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  API_URL,
  apiCreateProject,
  linkIn,
  registerUser,
  waitForEmail,
  type TestUser,
} from './helpers';

/**
 * Invites go to email addresses, so typing an address at sign-up must not be
 * enough to receive them: the account has to confirm it owns the address.
 */

const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function projectNames(request: APIRequestContext, user: TestUser) {
  const res = await request.get(`${API_URL}/api/projects`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
  });
  const { projects } = (await res.json()) as { projects: Array<{ name: string }> };
  return projects.map((p) => p.name);
}

async function invite(
  request: APIRequestContext,
  owner: TestUser,
  projectId: string,
  email: string,
) {
  const res = await request.post(`${API_URL}/api/projects/${projectId}/invites`, {
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    data: { email, role: 'editor' },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { status: 'added' | 'invited'; inviteUrl?: string };
}

test.describe('Email confirmation', () => {
  test('signing up with an invited address gets nothing until the address is confirmed', async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const owner = await registerUser(ctxA, 'Olivia Owner');
    const name = `Payroll ${uniq()}`;
    const project = { ...(await apiCreateProject(ctxA.request, owner, name)), name };
    const email = `ana-${uniq()}@example.com`;
    await invite(ctxA.request, owner, project.id, email);

    // Someone signs up with that address (and can't read Ana's inbox)
    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    const user = await registerUser(ctxB, 'Ana', 'ana', { email, verify: false });
    expect(await projectNames(ctxB.request, user)).not.toContain(project.name);
    // Logging in again doesn't hand it over either
    const login = await ctxB.request.post(`${API_URL}/api/auth/login`, {
      data: { email, password: user.password },
    });
    expect(login.status()).toBe(200);
    expect(await projectNames(ctxB.request, user)).not.toContain(project.name);

    // The dashboard says why, and can send the link again
    await b.goto('/');
    const banner = b.getByTestId('confirm-email-banner');
    await expect(banner).toContainText(`we sent a link to ${email}`);
    await expect(b.getByText(project.name)).toHaveCount(0);
    await banner.getByRole('button', { name: 'Send it again' }).click();
    await expect(banner).toContainText('Sent. Check your inbox.');

    // Whoever really owns the address opens the link: the invite is theirs
    const sent = await waitForEmail(ctxB.request, email, /Confirm your email/);
    const link = new URL(linkIn(sent));
    await b.goto(link.pathname + link.search);
    await expect(b.getByTestId('verify-email')).toContainText('Your email is confirmed');
    await expect(b.getByTestId('verify-email')).toContainText('1 invitation was waiting for you');
    // The token doesn't linger in the address bar
    await expect(b).toHaveURL(/\/verify-email$/);
    await b.getByRole('button', { name: 'Go to your dashboard' }).click();
    await expect(b.getByText(project.name)).toBeVisible();
    await expect(b.getByTestId('confirm-email-banner')).toHaveCount(0);

    await ctxA.close();
    await ctxB.close();
  });

  test('an unconfirmed account doesn’t catch invites sent later', async ({ browser }) => {
    const ctxM = await browser.newContext();
    const email = `cfo-${uniq()}@example.com`;
    const mallory = await registerUser(ctxM, 'Mallory', 'm', { email, verify: false });

    const ctxA = await browser.newContext();
    const owner = await registerUser(ctxA, 'Olivia Owner');
    const name = `Board ${uniq()}`;
    const project = { ...(await apiCreateProject(ctxA.request, owner, name)), name };
    // Not "added": the address isn't confirmed, so it's a pending invite with a link
    const result = await invite(ctxA.request, owner, project.id, email);
    expect(result.status).toBe('invited');
    expect(result.inviteUrl).toMatch(/\/invite\//);
    expect(await projectNames(ctxM.request, mallory)).not.toContain(project.name);

    // The invite email went to the address; only its owner can follow it
    await waitForEmail(ctxA.request, email, /invited you to/);

    await ctxA.close();
    await ctxM.close();
  });

  test('a broken or tampered link says so', async ({ page }) => {
    await page.goto('/verify-email?token=not-a-real-token');
    await expect(page.getByTestId('verify-email')).toContainText('We couldn’t confirm your email');
    await expect(page.getByRole('alert')).toContainText('This confirmation link is broken.');
  });

  test('opening an invite link confirms the address it was sent to', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const owner = await registerUser(ctxA, 'Olivia Owner');
    const name = `Ops ${uniq()}`;
    const project = { ...(await apiCreateProject(ctxA.request, owner, name)), name };
    const email = `newhire-${uniq()}@example.com`;
    const { inviteUrl } = await invite(ctxA.request, owner, project.id, email);

    const ctxN = await browser.newContext();
    const n = await ctxN.newPage();
    const user = await registerUser(ctxN, 'Nico', 'n', { email, verify: false });
    await n.goto(inviteUrl!);
    await expect(n).toHaveURL(/\/p\//, { timeout: 15_000 });
    const me = await ctxN.request.get(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    expect(((await me.json()) as { user: { emailVerified: boolean } }).user.emailVerified).toBe(
      true,
    );
    await n.goto('/');
    await expect(n.getByText(project.name)).toBeVisible();
    await expect(n.getByTestId('confirm-email-banner')).toHaveCount(0);

    await ctxA.close();
    await ctxN.close();
  });
});
